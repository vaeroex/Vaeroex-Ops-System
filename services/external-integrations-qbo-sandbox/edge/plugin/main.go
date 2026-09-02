package main

import (
	"strings"

	callbackedge "vaeroex.local/qbo-oauth-callback-edge"

	"github.com/proxy-wasm/proxy-wasm-go-sdk/proxywasm"
	"github.com/proxy-wasm/proxy-wasm-go-sdk/proxywasm/types"
)

func main() {}

func init() {
	proxywasm.SetVMContext(&vmContext{})
}

type vmContext struct {
	types.DefaultVMContext
}

type pluginContext struct {
	types.DefaultPluginContext
}

type httpContext struct {
	types.DefaultHttpContext
}

func (*vmContext) NewPluginContext(uint32) types.PluginContext {
	return &pluginContext{}
}

func (*pluginContext) NewHttpContext(uint32) types.HttpContext {
	return &httpContext{}
}

func (*httpContext) OnHttpRequestHeaders(headerCount int, endOfStream bool) (action types.Action) {
	action = types.ActionPause
	defer func() {
		if recover() != nil {
			sendFixedResponse(500, "callback unavailable")
		}
	}()

	if headerCount > callbackedge.MaxHeaderCount {
		sendFixedResponse(400, "invalid callback")
		return action
	}
	if hasForbiddenBodyHeaders() {
		sendFixedResponse(400, "invalid callback")
		return action
	}
	method, methodError := proxywasm.GetProperty([]string{"request", "method"})
	path, pathError := proxywasm.GetProperty([]string{"request", "path"})
	rawQuery, queryError := proxywasm.GetProperty([]string{"request", "query"})
	if methodError != nil || pathError != nil || queryError != nil {
		sendFixedResponse(500, "callback unavailable")
		return action
	}
	defer zeroBytes(method)
	defer zeroBytes(path)
	defer zeroBytes(rawQuery)
	if callbackedge.IsConfirmationRequest(string(method), string(path), string(rawQuery)) {
		sendFixedResponse(200, "Authorization processing complete.")
		return action
	}

	handoff, err := callbackedge.ParseForwardedCallback(
		string(method),
		string(path),
		string(rawQuery),
	)
	if err != nil {
		sendFixedResponse(400, "invalid callback")
		return action
	}
	if !clearReservedHandoffHeaders() {
		sendFixedResponse(500, "callback unavailable")
		return action
	}
	if proxywasm.ReplaceHttpRequestHeader(":path", callbackedge.CallbackPath) != nil ||
		proxywasm.AddHttpRequestHeader(callbackedge.HandoffVersionHeader, callbackedge.HandoffVersion) != nil ||
		proxywasm.AddHttpRequestHeader(callbackedge.HandoffCodeHeader, handoff.Code) != nil ||
		proxywasm.AddHttpRequestHeader(callbackedge.HandoffStateHeader, handoff.State) != nil ||
		proxywasm.AddHttpRequestHeader(callbackedge.HandoffRealmIDHeader, handoff.RealmID) != nil {
		sendFixedResponse(500, "callback unavailable")
		return action
	}
	return types.ActionContinue
}

func hasForbiddenBodyHeaders() bool {
	headers, err := proxywasm.GetHttpRequestHeaders()
	if err != nil {
		return true
	}
	contentLengthCount := 0
	for _, header := range headers {
		name := strings.ToLower(header[0])
		switch name {
		case "transfer-encoding", "expect":
			return true
		case "content-length":
			contentLengthCount++
			if contentLengthCount > 1 || strings.TrimSpace(header[1]) != "0" {
				return true
			}
		}
	}
	return false
}

func zeroBytes(value []byte) {
	for index := range value {
		value[index] = 0
	}
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

func sendFixedResponse(status uint32, body string) {
	proxywasm.SendHttpResponse(status, [][2]string{
		{"content-type", "text/plain; charset=utf-8"},
		{"cache-control", "no-store"},
		{"referrer-policy", "no-referrer"},
		{"x-content-type-options", "nosniff"},
	}, []byte(body), -1)
}
