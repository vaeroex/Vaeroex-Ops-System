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

func (*vmContext) NewPluginContext(uint32) types.PluginContext { return &pluginContext{} }
func (*pluginContext) NewHttpContext(uint32) types.HttpContext { return &httpContext{} }

func (*httpContext) OnHttpRequestHeaders(headerCount int, _ bool) (action types.Action) {
	action = types.ActionPause
	defer func() {
		if recover() != nil {
			sendFixedResponse(500, "integration callback unavailable")
		}
	}()
	if headerCount > callbackedge.MaxInputHeaderCount {
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

	headers, headersError := proxywasm.GetHttpRequestHeaders()
	if headersError != nil || !callbackedge.IsBoundedClientHeaderMap(headers) || callbackedge.HasForbiddenClientHeaders(headers) {
		sendFixedResponse(400, "invalid integration request")
		return action
	}

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
	handoff, parseError := callbackedge.ParseForwardedHeaderCallback(
		string(method), string(path), string(rawQuery), headers,
	)
	if parseError != nil {
		sendFixedResponse(400, "invalid integration callback")
		return action
	}
	if !clearReservedHandoffHeaders() {
		sendFixedResponse(500, "integration callback unavailable")
		return action
	}
	if proxywasm.ReplaceHttpRequestHeader(":path", callbackedge.CallbackPath) != nil ||
		proxywasm.AddHttpRequestHeader(callbackedge.HandoffVersionHeader, callbackedge.HandoffVersion) != nil ||
		proxywasm.AddHttpRequestHeader(callbackedge.HandoffQueryHeader, handoff.EncodedQuery) != nil {
		sendFixedResponse(500, "integration callback unavailable")
		return action
	}
	return types.ActionContinue
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
