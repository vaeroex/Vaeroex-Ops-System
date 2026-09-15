package main

import (
	"testing"

	callbackedge "vaeroex.local/square-oauth-callback-edge"

	"github.com/proxy-wasm/proxy-wasm-go-sdk/proxywasm/proxytest"
	"github.com/proxy-wasm/proxy-wasm-go-sdk/proxywasm/types"
)

const validStateFixture = "0123456789_abcdefghijklmnopqrstuvwxyz-ABCDE"

func TestManagedHeaderEventForwardsLegitimateCallbackWhenPlatformFlagIsFalse(t *testing.T) {
	host, reset := newCallbackHost("GET", callbackedge.CallbackPath,
		"state="+validStateFixture+"&code=synthetic-code")
	defer reset()

	contextID := host.InitializeHttpContext()
	action := host.CallOnRequestHeaders(contextID, [][2]string{
		{":method", "GET"},
		{":path", callbackedge.CallbackPath + "?redacted-at-edge"},
		{"content-length", "0"},
		{callbackedge.HandoffCodeHeader, "forged"},
	}, false)
	if action != types.ActionContinue {
		t.Fatalf("expected the managed header event to continue, got %v", action)
	}
	if response := host.GetSentLocalResponse(contextID); response != nil {
		t.Fatalf("expected no local rejection, got %#v", response)
	}

	headers := headerMap(host.GetCurrentRequestHeaders(contextID))
	if headers[":path"] != callbackedge.CallbackPath ||
		headers[callbackedge.HandoffVersionHeader] != callbackedge.HandoffVersion ||
		headers[callbackedge.HandoffStateHeader] != validStateFixture ||
		headers[callbackedge.HandoffCodeHeader] != "synthetic-code" {
		t.Fatalf("unexpected sanitized handoff: %#v", headers)
	}
}

func TestManagedHeaderEventForwardsSanitizedDenialWhenPlatformFlagIsFalse(t *testing.T) {
	host, reset := newCallbackHost("GET", callbackedge.CallbackPath,
		"error=access_denied&error_description=synthetic%20provider%20message&state="+validStateFixture)
	defer reset()

	contextID := host.InitializeHttpContext()
	action := host.CallOnRequestHeaders(contextID, nil, false)
	if action != types.ActionContinue || host.GetSentLocalResponse(contextID) != nil {
		t.Fatalf("expected denial handoff to continue without a local response, got %v %#v", action, host.GetSentLocalResponse(contextID))
	}
	headers := headerMap(host.GetCurrentRequestHeaders(contextID))
	if headers[callbackedge.HandoffDeniedHeader] != "1" ||
		headers[callbackedge.HandoffStateHeader] != validStateFixture ||
		headers[callbackedge.HandoffCodeHeader] != "" {
		t.Fatalf("unexpected sanitized denial handoff: %#v", headers)
	}
	for name, value := range headers {
		if name == "error" || name == "error_description" || value == "synthetic provider message" {
			t.Fatalf("provider denial details crossed the edge: %#v", headers)
		}
	}
}

func TestManagedHeaderEventRejectsMalformedAndBodyIndicatedCallbacks(t *testing.T) {
	tests := []struct {
		name    string
		query   string
		headers [][2]string
	}{
		{name: "duplicate code", query: "state=" + validStateFixture + "&code=x&code=y"},
		{name: "non-ASCII code", query: "state=" + validStateFixture + "&code=%FF"},
		{name: "body indicated", query: "state=" + validStateFixture + "&code=x", headers: [][2]string{{"content-length", "1"}}},
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
			if response == nil || response.StatusCode != 400 {
				t.Fatalf("expected fixed 400 rejection, got %#v", response)
			}
		})
	}
}

func TestExactSyntheticDiagnosticReturnsOnlyFinitePredicate(t *testing.T) {
	for _, test := range []struct {
		name       string
		query      string
		extra      [][2]string
		statusCode uint32
		body       string
	}{
		{name: "accepted", query: "state=" + validStateFixture + "&code=vaeroex-edge-diagnostic", statusCode: 200, body: "callback_predicate_accepted"},
		{name: "body indicator", query: "state=" + validStateFixture + "&code=vaeroex-edge-diagnostic", extra: [][2]string{{"content-length", "1"}}, statusCode: 400, body: "callback_predicate_body_indicator"},
	} {
		t.Run(test.name, func(t *testing.T) {
			host, reset := newCallbackHost("GET", callbackedge.CallbackPath, test.query)
			defer reset()
			contextID := host.InitializeHttpContext()
			headers := append([][2]string{{":path", diagnosticTarget}, {callbackedge.HandoffVersionHeader, diagnosticMarker}}, test.extra...)
			if action := host.CallOnRequestHeaders(contextID, headers, false); action != types.ActionPause {
				t.Fatalf("diagnostic must terminate at the edge, got %v", action)
			}
			response := host.GetSentLocalResponse(contextID)
			if response == nil || response.StatusCode != test.statusCode || string(response.Data) != test.body {
				t.Fatalf("unexpected finite diagnostic response: %#v", response)
			}
		})
	}
}

func TestDiagnosticMarkerMustBeExactAndUnique(t *testing.T) {
	for _, headers := range [][][2]string{
		{{":path", diagnosticTarget}, {callbackedge.HandoffVersionHeader, "wrong"}},
		{{":path", callbackedge.CallbackPath + "?state=" + validStateFixture + "&code=other"}, {callbackedge.HandoffVersionHeader, diagnosticMarker}},
	} {
		host, reset := newCallbackHost("GET", callbackedge.CallbackPath, "state="+validStateFixture+"&code=synthetic-code")
		contextID := host.InitializeHttpContext()
		if action := host.CallOnRequestHeaders(contextID, headers, false); action != types.ActionContinue {
			reset()
			t.Fatalf("non-diagnostic request should follow the normal path, got %v", action)
		}
		if response := host.GetSentLocalResponse(contextID); response != nil {
			reset()
			t.Fatalf("non-diagnostic request received diagnostic response: %#v", response)
		}
		reset()
	}

	host, reset := newCallbackHost("GET", callbackedge.CallbackPath, "state="+validStateFixture+"&code=synthetic-code")
	defer reset()
	contextID := host.InitializeHttpContext()
	action := host.CallOnRequestHeaders(contextID, [][2]string{
		{":path", diagnosticTarget},
		{callbackedge.HandoffVersionHeader, diagnosticMarker},
		{callbackedge.HandoffVersionHeader, diagnosticMarker},
	}, false)
	if action != types.ActionPause || host.GetSentLocalResponse(contextID) == nil {
		t.Fatalf("duplicate reserved diagnostic markers must fail closed, got %v %#v", action, host.GetSentLocalResponse(contextID))
	}
}

func newCallbackHost(method, path, query string) (proxytest.HostEmulator, func()) {
	options := proxytest.NewEmulatorOption().
		WithVMContext(&vmContext{}).
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
