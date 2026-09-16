package main

import (
	"encoding/base64"
	"fmt"
	"strings"
	"testing"
	"time"

	callbackedge "vaeroex.local/square-oauth-callback-edge"

	"github.com/proxy-wasm/proxy-wasm-go-sdk/proxywasm/proxytest"
	"github.com/proxy-wasm/proxy-wasm-go-sdk/proxywasm/types"
)

const validStateFixture = "0123456789_abcdefghijklmnopqrstuvwxyz-ABCDE"

func TestManagedHeaderEventForwardsExactEncodedQuery(t *testing.T) {
	rawQuery := "state=" + validStateFixture + "&code=synthetic-code"
	host, reset := newCallbackHost("GET", callbackedge.CallbackPath, rawQuery)
	defer reset()

	contextID := host.InitializeHttpContext()
	action := host.CallOnRequestHeaders(contextID, [][2]string{
		{":method", "GET"},
		{":path", callbackedge.CallbackPath + "?redacted-at-edge"},
		{"content-length", "0"},
	}, false)
	if action != types.ActionContinue {
		t.Fatalf("expected the managed header event to continue, got %v", action)
	}
	if response := host.GetSentLocalResponse(contextID); response != nil {
		t.Fatalf("expected no local rejection, got %#v", response)
	}

	headers := headerMap(host.GetCurrentRequestHeaders(contextID))
	decoded, decodeError := base64.RawURLEncoding.DecodeString(headers[callbackedge.HandoffQueryHeader])
	if decodeError != nil || headers[":path"] != callbackedge.CallbackPath ||
		headers[callbackedge.HandoffVersionHeader] != callbackedge.HandoffVersion ||
		string(decoded) != rawQuery || headers[callbackedge.HandoffStateHeader] != "" ||
		headers[callbackedge.HandoffCodeHeader] != "" {
		t.Fatalf("unexpected bounded query handoff: %#v", headers)
	}
}

func TestManagedHeaderEventRejectsClientAuthorityAliasesAndForgedHandoffs(t *testing.T) {
	for _, name := range []string{
		"forwarded",
		"x-forwarded-host",
		"x-original-url",
		"x-rewrite-url",
		callbackedge.HandoffVersionHeader,
		callbackedge.HandoffQueryHeader,
		callbackedge.HandoffCodeHeader,
		callbackedge.HandoffStateHeader,
		callbackedge.HandoffDeniedHeader,
	} {
		host, reset := newCallbackHost("GET", callbackedge.CallbackPath, "state="+validStateFixture+"&code=synthetic-code")
		contextID := host.InitializeHttpContext()
		action := host.CallOnRequestHeaders(contextID, [][2]string{{name, "synthetic"}}, false)
		response := host.GetSentLocalResponse(contextID)
		if action != types.ActionPause || response == nil || response.StatusCode != 400 {
			reset()
			t.Fatalf("expected %s to fail before forwarding, got %v %#v", name, action, response)
		}
		reset()
	}
}

func TestManagedHeaderEventBounds64InputsBeforeAppendingTwoHandoffHeaders(t *testing.T) {
	rawQuery := "state=" + validStateFixture + "&code=synthetic-code"
	headers := [][2]string{
		{":method", "GET"},
		{":path", callbackedge.CallbackPath + "?redacted-at-edge"},
		{"host", "square.vaeroex.com"},
		{"content-length", "0"},
	}
	for len(headers) < callbackedge.MaxInputHeaderCount {
		headers = append(headers, [2]string{fmt.Sprintf("x-vaeroex-padding-%d", len(headers)), "x"})
	}

	host, reset := newCallbackHost("GET", callbackedge.CallbackPath, rawQuery)
	contextID := host.InitializeHttpContext()
	action := host.CallOnRequestHeaders(contextID, headers, false)
	if action != types.ActionContinue || host.GetSentLocalResponse(contextID) != nil {
		reset()
		t.Fatalf("expected exactly %d edge input headers to continue", callbackedge.MaxInputHeaderCount)
	}
	forwarded := host.GetCurrentRequestHeaders(contextID)
	if len(forwarded) != callbackedge.MaxInputHeaderCount+2 {
		reset()
		t.Fatalf("expected exactly two trusted handoff headers, got %d total headers", len(forwarded))
	}
	reset()

	host, reset = newCallbackHost("GET", callbackedge.CallbackPath, rawQuery)
	defer reset()
	contextID = host.InitializeHttpContext()
	action = host.CallOnRequestHeaders(contextID, append(headers, [2]string{"x-vaeroex-over-limit", "x"}), false)
	response := host.GetSentLocalResponse(contextID)
	if action != types.ActionPause || response == nil || response.StatusCode != 400 {
		t.Fatalf("expected a 65th edge input header to fail closed, got %v %#v", action, response)
	}
}

func TestManagedHeaderEventForwardsExactEncodedDenialQuery(t *testing.T) {
	rawQuery := "error=access_denied&error_description=synthetic%20provider%20message&state=" + validStateFixture
	host, reset := newCallbackHost("GET", callbackedge.CallbackPath, rawQuery)
	defer reset()

	contextID := host.InitializeHttpContext()
	action := host.CallOnRequestHeaders(contextID, nil, false)
	if action != types.ActionContinue || host.GetSentLocalResponse(contextID) != nil {
		t.Fatalf("expected denial handoff to continue without a local response, got %v %#v", action, host.GetSentLocalResponse(contextID))
	}
	headers := headerMap(host.GetCurrentRequestHeaders(contextID))
	decoded, decodeError := base64.RawURLEncoding.DecodeString(headers[callbackedge.HandoffQueryHeader])
	if decodeError != nil || string(decoded) != rawQuery || headers[callbackedge.HandoffDeniedHeader] != "" ||
		headers[callbackedge.HandoffStateHeader] != "" || headers[callbackedge.HandoffCodeHeader] != "" {
		t.Fatalf("unexpected bounded denial query handoff: %#v", headers)
	}
}

func TestManagedHeaderEventForwardsSemanticFailuresToBackend(t *testing.T) {
	for _, query := range []string{
		"state=" + validStateFixture + "&code=x&code=y",
		"state=" + validStateFixture + "&code=x&scope=unknown",
		"state=" + validStateFixture + "&code=x&error=access_denied",
		"state=short&code=x",
	} {
		host, reset := newCallbackHost("GET", callbackedge.CallbackPath, query)
		contextID := host.InitializeHttpContext()
		action := host.CallOnRequestHeaders(contextID, nil, false)
		if action != types.ActionContinue || host.GetSentLocalResponse(contextID) != nil {
			reset()
			t.Fatalf("semantic query must reach the disabled backend: %q %v %#v", query, action, host.GetSentLocalResponse(contextID))
		}
		decoded, err := base64.RawURLEncoding.DecodeString(headerMap(host.GetCurrentRequestHeaders(contextID))[callbackedge.HandoffQueryHeader])
		if err != nil || string(decoded) != query {
			reset()
			t.Fatalf("semantic query octets changed at edge: %q %q %v", query, decoded, err)
		}
		reset()
	}
}

func TestManagedHeaderEventRejectsOnlyMalformedEnvelopesAndBodyIndicators(t *testing.T) {
	tests := []struct {
		name       string
		query      string
		headers    [][2]string
		statusCode uint32
	}{
		{name: "missing query attribute", query: "", statusCode: 500},
		{name: "unsafe raw query", query: "state=" + validStateFixture + "&code=raw space", statusCode: 400},
		{name: "body indicated", query: "state=" + validStateFixture + "&code=x", headers: [][2]string{{"content-length", "1"}}, statusCode: 400},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			host, reset := newCallbackHost("GET", callbackedge.CallbackPath, test.query)
			defer reset()
			contextID := host.InitializeHttpContext()
			action := host.CallOnRequestHeaders(contextID, test.headers, false)
			if action != types.ActionPause {
				t.Fatalf("expected rejection to pause, got %v", action)
			}
			response := host.GetSentLocalResponse(contextID)
			if response == nil || response.StatusCode != test.statusCode {
				t.Fatalf("expected fixed %d rejection, got %#v", test.statusCode, response)
			}
		})
	}
}

func TestExactPublicCanaryReturnsOnlyFinitePredicateLabelsInsideItsWindow(t *testing.T) {
	window := diagnosticWindow{notBeforeUnix: 100, expiresUnix: 1300}
	reasons := []callbackedge.RejectionReason{
		callbackedge.RejectionNone,
		callbackedge.RejectionHeaderBounds,
		callbackedge.RejectionHeaderSpoofing,
		callbackedge.RejectionTransferEncoding,
		callbackedge.RejectionExpect,
		callbackedge.RejectionDuplicateContentLength,
		callbackedge.RejectionNonzeroContentLength,
		callbackedge.RejectionTargetMismatch,
		callbackedge.RejectionMethod,
		callbackedge.RejectionPath,
		callbackedge.RejectionQueryEmpty,
		callbackedge.RejectionQueryLimit,
		callbackedge.RejectionQueryUnsafe,
	}
	for _, reason := range reasons {
		status, body, ok := exactDiagnosticResponse(diagnosticCanaryTarget, reason, window.notBeforeUnix, window)
		expectedStatus := uint32(400)
		if reason == callbackedge.RejectionNone {
			expectedStatus = 200
		}
		if !ok || status != expectedStatus || body != "callback_predicate_"+string(reason) {
			t.Fatalf("unexpected finite response for %q: %d %q %v", reason, status, body, ok)
		}
	}
}

func TestPublicCanaryCannotRespondOutsideItsExactTargetAndTimeWindow(t *testing.T) {
	window := diagnosticWindow{notBeforeUnix: 100, expiresUnix: 1300}
	for _, test := range []struct {
		name   string
		target string
		now    int64
	}{
		{name: "wrong target", target: callbackedge.CallbackPath + "?state=other&code=VAEROEX_PUBLIC_NEVER_ISSUED_CANARY", now: window.notBeforeUnix},
		{name: "before window", target: diagnosticCanaryTarget, now: window.notBeforeUnix - 1},
		{name: "at expiry", target: diagnosticCanaryTarget, now: window.expiresUnix},
		{name: "after expiry", target: diagnosticCanaryTarget, now: window.expiresUnix + 1},
	} {
		t.Run(test.name, func(t *testing.T) {
			status, body, ok := exactDiagnosticResponse(test.target, callbackedge.RejectionNonzeroContentLength, test.now, window)
			if ok || status != 0 || body != "" {
				t.Fatalf("diagnostic escaped its exact bound: %d %q %v", status, body, ok)
			}
		})
	}
}

func TestDiagnosticConfigurationIsDefaultOffAndStrictlyBounded(t *testing.T) {
	valid := []byte(diagnosticConfigVersion + "\n100\n1300\n")
	if window := parseDiagnosticWindow(valid); window != (diagnosticWindow{notBeforeUnix: 100, expiresUnix: 1300}) {
		t.Fatalf("expected exact 20-minute window, got %#v", window)
	}
	for _, configuration := range [][]byte{
		nil,
		{},
		[]byte(diagnosticConfigVersion + "\n100\n1301\n"),
		[]byte(diagnosticConfigVersion + "\n100\n100\n"),
		[]byte(diagnosticConfigVersion + "\n0100\n200\n"),
		[]byte(diagnosticConfigVersion + "\n+100\n200\n"),
		[]byte(diagnosticConfigVersion + "\n100\n200"),
		[]byte("unknown\n100\n200\n"),
		[]byte(strings.Repeat("x", maxDiagnosticConfigBytes+1)),
	} {
		if window := parseDiagnosticWindow(configuration); window != (diagnosticWindow{}) {
			t.Fatalf("invalid configuration enabled the diagnostic: %q %#v", configuration, window)
		}
	}
}

func TestConfiguredCanaryUsesTheUnchangedParserDecisionPath(t *testing.T) {
	now := time.Now().Unix()
	configuration := []byte(fmt.Sprintf("%s\n%d\n%d\n", diagnosticConfigVersion, now-1, now+600))
	rawQuery := strings.TrimPrefix(diagnosticCanaryTarget, callbackedge.CallbackPath+"?")
	host, reset := newCallbackHostWithConfiguration("GET", callbackedge.CallbackPath, rawQuery, configuration)
	defer reset()
	if status := host.StartPlugin(); status != types.OnPluginStartStatusOK {
		t.Fatalf("expected valid bounded configuration to start, got %v", status)
	}
	contextID := host.InitializeHttpContext()
	action := host.CallOnRequestHeaders(contextID, [][2]string{{":path", diagnosticCanaryTarget}, {"content-length", "1"}}, false)
	response := host.GetSentLocalResponse(contextID)
	if action != types.ActionPause || response == nil || response.StatusCode != 400 ||
		string(response.Data) != "callback_predicate_nonzero_content_length" {
		t.Fatalf("unexpected exact canary result: %v %#v", action, response)
	}
}

func TestAbsentOrInvalidConfigurationCannotEnableTheCanary(t *testing.T) {
	rawQuery := strings.TrimPrefix(diagnosticCanaryTarget, callbackedge.CallbackPath+"?")
	for _, configuration := range [][]byte{nil, []byte("invalid")} {
		host, reset := newCallbackHostWithConfiguration("GET", callbackedge.CallbackPath, rawQuery, configuration)
		if status := host.StartPlugin(); status != types.OnPluginStartStatusOK {
			reset()
			t.Fatalf("invalid configuration must preserve normal service, got %v", status)
		}
		contextID := host.InitializeHttpContext()
		action := host.CallOnRequestHeaders(contextID, [][2]string{{":path", diagnosticCanaryTarget}, {"content-length", "1"}}, false)
		response := host.GetSentLocalResponse(contextID)
		if action != types.ActionPause || response == nil || response.StatusCode != 400 ||
			string(response.Data) != "invalid integration callback" {
			reset()
			t.Fatalf("configuration unexpectedly enabled a predicate response: %v %#v", action, response)
		}
		reset()
	}
}

func newCallbackHost(method, path, query string) (proxytest.HostEmulator, func()) {
	return newCallbackHostWithConfiguration(method, path, query, nil)
}

func newCallbackHostWithConfiguration(method, path, query string, configuration []byte) (proxytest.HostEmulator, func()) {
	options := proxytest.NewEmulatorOption().
		WithVMContext(&vmContext{}).
		WithPluginConfiguration(configuration).
		WithProperty([]string{"request", "method"}, []byte(method)).
		WithProperty([]string{"request", "path"}, []byte(path)).
		WithProperty([]string{"request", "query"}, []byte(query))
	return proxytest.NewHostEmulator(options)
}

func headerMap(headers [][2]string) map[string]string {
	result := make(map[string]string, len(headers))
	for _, header := range headers {
		result[header[0]] = header[1]
	}
	return result
}
