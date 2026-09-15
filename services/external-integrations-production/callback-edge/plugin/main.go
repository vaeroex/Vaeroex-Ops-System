package main

import (
	callbackedge "vaeroex.local/square-oauth-callback-edge"

	"github.com/proxy-wasm/proxy-wasm-go-sdk/proxywasm"
	"github.com/proxy-wasm/proxy-wasm-go-sdk/proxywasm/types"
)

func main() {}

func init() {
	proxywasm.SetVMContext(&vmContext{})
}

type vmContext struct{ types.DefaultVMContext }
type pluginContext struct{ types.DefaultPluginContext }
type httpContext struct{ types.DefaultHttpContext }

const (
	diagnosticMarker = "vaeroex_public_synthetic_predicate_v1"
	diagnosticTarget = callbackedge.CallbackPath + "?state=0123456789_abcdefghijklmnopqrstuvwxyz-ABCDE&code=vaeroex-edge-diagnostic"
)

func (*vmContext) NewPluginContext(uint32) types.PluginContext { return &pluginContext{} }
func (*pluginContext) NewHttpContext(uint32) types.HttpContext { return &httpContext{} }

func (*httpContext) OnHttpRequestHeaders(headerCount int, _ bool) (action types.Action) {
	action = types.ActionPause
	defer func() {
		if recover() != nil {
			sendFixedResponse(500, "integration callback unavailable")
		}
	}()
	if headerCount > callbackedge.MaxHeaderCount {
		sendFixedResponse(400, "invalid integration request")
		return action
	}
	method, methodError := proxywasm.GetProperty([]string{"request", "method"})
	path, pathError := proxywasm.GetProperty([]string{"request", "path"})
	rawQuery, queryError := proxywasm.GetProperty([]string{"request", "query"})
	if methodError != nil || pathError != nil || queryError != nil {
		sendFixedResponse(500, "integration callback unavailable")
		return action
	}
	defer zeroBytes(method)
	defer zeroBytes(path)
	defer zeroBytes(rawQuery)

	if callbackedge.IsHealthRequest(string(method), string(path), string(rawQuery)) ||
		callbackedge.IsWebhookRequest(string(method), string(path), string(rawQuery)) {
		if !clearReservedHandoffHeaders() {
			sendFixedResponse(500, "integration callback unavailable")
			return action
		}
		return types.ActionContinue
	}
	// LbEdgeExtension invokes only REQUEST_HEADERS and does not expose request
	// bodies to the plugin. Its callback flag is therefore not body evidence.
	// Reject every forwarded HTTP body indicator instead.
	headers, headersError := proxywasm.GetHttpRequestHeaders()
	if headersError != nil {
		sendFixedResponse(400, "invalid integration callback")
		return action
	}
	requestTarget, requestTargetError := proxywasm.GetHttpRequestHeader(":path")
	handoff, reason := callbackedge.DiagnoseForwardedHeaderCallback(
		string(method), string(path), string(rawQuery), headers,
	)
	if requestTargetError == nil && isExactDiagnosticCanary(headers, requestTarget) {
		status := uint32(200)
		if reason != callbackedge.RejectionNone {
			status = 400
		}
		sendFixedResponse(status, "callback_predicate_"+string(reason))
		return action
	}
	if reason != callbackedge.RejectionNone {
		sendFixedResponse(400, "invalid integration callback")
		return action
	}
	if !clearReservedHandoffHeaders() {
		sendFixedResponse(500, "integration callback unavailable")
		return action
	}
	if proxywasm.ReplaceHttpRequestHeader(":path", callbackedge.CallbackPath) != nil ||
		proxywasm.AddHttpRequestHeader(callbackedge.HandoffVersionHeader, callbackedge.HandoffVersion) != nil ||
		proxywasm.AddHttpRequestHeader(callbackedge.HandoffStateHeader, handoff.State) != nil {
		sendFixedResponse(500, "integration callback unavailable")
		return action
	}
	if handoff.Denied {
		if proxywasm.AddHttpRequestHeader(callbackedge.HandoffDeniedHeader, "1") != nil {
			sendFixedResponse(500, "integration callback unavailable")
			return action
		}
	} else if proxywasm.AddHttpRequestHeader(callbackedge.HandoffCodeHeader, handoff.Code) != nil {
		sendFixedResponse(500, "integration callback unavailable")
		return action
	}
	return types.ActionContinue
}

func isExactDiagnosticCanary(headers [][2]string, requestTarget string) bool {
	if requestTarget != diagnosticTarget {
		return false
	}
	markerCount := 0
	for _, header := range headers {
		if header[0] == callbackedge.HandoffVersionHeader {
			markerCount++
			if header[1] != diagnosticMarker {
				return false
			}
		}
	}
	return markerCount == 1
}

func clearReservedHandoffHeaders() bool {
	for _, name := range callbackedge.ReservedHandoffHeaders {
		err := proxywasm.RemoveHttpRequestHeader(name)
		if err != nil && err != types.ErrorStatusNotFound {
			return false
		}
		if _, err = proxywasm.GetHttpRequestHeader(name); err != types.ErrorStatusNotFound {
			return false
		}
	}
	return true
}

func zeroBytes(value []byte) {
	for index := range value {
		value[index] = 0
	}
}

func sendFixedResponse(status uint32, body string) {
	if err := proxywasm.SendHttpResponse(status, [][2]string{
		{"content-type", "text/plain; charset=utf-8"},
		{"cache-control", "no-store"},
		{"referrer-policy", "no-referrer"},
		{"x-content-type-options", "nosniff"},
	}, []byte(body), -1); err != nil {
		// The managed extension ignores a pause return value. Escalate a failed
		// local response to a plugin failure so fail_open=false remains the
		// authoritative rejection boundary.
		panic(err)
	}
}
