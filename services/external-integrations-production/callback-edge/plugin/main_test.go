package main

import (
	"encoding/base64"
	"testing"

	callbackedge "vaeroex.local/square-oauth-callback-edge"

	"github.com/proxy-wasm/proxy-wasm-go-sdk/proxywasm/proxytest"
	"github.com/proxy-wasm/proxy-wasm-go-sdk/proxywasm/types"
)

const validStateFixture = "0123456789_abcdefghijklmnopqrstuvwxyz-ABCDE"

func TestManagedHeaderEventForwardsExactEncodedQueryAndClearsForgedHandoffs(t *testing.T) {
	rawQuery := "state=" + validStateFixture + "&code=synthetic-code"
	host, reset := newCallbackHost("GET", callbackedge.CallbackPath, rawQuery)
	defer reset()

	contextID := host.InitializeHttpContext()
	action := host.CallOnRequestHeaders(contextID, [][2]string{
		{":method", "GET"},
		{":path", callbackedge.CallbackPath + "?redacted-at-edge"},
		{"content-length", "0"},
		{callbackedge.HandoffCodeHeader, "forged"},
		{callbackedge.HandoffStateHeader, "forged"},
		{callbackedge.HandoffQueryHeader, "forged"},
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
