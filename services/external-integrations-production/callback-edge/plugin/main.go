package main

import (
	"strconv"
	"strings"
	"time"

	callbackedge "vaeroex.local/square-oauth-callback-edge"

	"github.com/proxy-wasm/proxy-wasm-go-sdk/proxywasm"
	"github.com/proxy-wasm/proxy-wasm-go-sdk/proxywasm/types"
)

func main() {}

func init() {
	proxywasm.SetVMContext(&vmContext{})
}

type vmContext struct{ types.DefaultVMContext }
type pluginContext struct {
	types.DefaultPluginContext
	diagnosticWindow diagnosticWindow
}
type httpContext struct {
	types.DefaultHttpContext
	diagnosticWindow diagnosticWindow
}

type diagnosticWindow struct {
	notBeforeUnix int64
	expiresUnix   int64
}

const (
	diagnosticCanaryTarget     = callbackedge.CallbackPath + "?state=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&code=VAEROEX_PUBLIC_NEVER_ISSUED_CANARY"
	diagnosticConfigVersion    = "vaeroex_public_callback_predicate_v1"
	maxDiagnosticConfigBytes   = 96
	maxDiagnosticWindowSeconds = int64(1200)
)

func (*vmContext) NewPluginContext(uint32) types.PluginContext { return &pluginContext{} }
func (context *pluginContext) NewHttpContext(uint32) types.HttpContext {
	return &httpContext{diagnosticWindow: context.diagnosticWindow}
}

func (context *pluginContext) OnPluginStart(configurationSize int) types.OnPluginStartStatus {
	context.diagnosticWindow = diagnosticWindow{}
	if configurationSize <= 0 || configurationSize > maxDiagnosticConfigBytes {
		return types.OnPluginStartStatusOK
	}
	configuration, err := proxywasm.GetPluginConfiguration()
	if err != nil {
		return types.OnPluginStartStatusOK
	}
	defer zeroBytes(configuration)
	context.diagnosticWindow = parseDiagnosticWindow(configuration)
	return types.OnPluginStartStatusOK
}

func (context *httpContext) OnHttpRequestHeaders(headerCount int, _ bool) (action types.Action) {
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
	handoff, rejectionReason := callbackedge.DiagnoseForwardedHeaderCallback(
		string(method), string(path), string(rawQuery), headers,
	)
	if context.diagnosticWindow.configured() {
		requestTarget, requestTargetError := proxywasm.GetHttpRequestHeader(":path")
		if requestTargetError == nil {
			status, body, ok := exactDiagnosticResponse(requestTarget, rejectionReason, time.Now().Unix(), context.diagnosticWindow)
			if ok {
				sendFixedResponse(status, body)
				return action
			}
		}
	}
	if rejectionReason != callbackedge.RejectionNone {
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

func exactDiagnosticResponse(requestTarget string, reason callbackedge.RejectionReason, nowUnix int64, window diagnosticWindow) (uint32, string, bool) {
	if requestTarget != diagnosticCanaryTarget || !window.enabledAt(nowUnix) {
		return 0, "", false
	}
	status := uint32(200)
	if reason != callbackedge.RejectionNone {
		status = 400
	}
	return status, "callback_predicate_" + string(reason), true
}

func parseDiagnosticWindow(configuration []byte) diagnosticWindow {
	if len(configuration) == 0 || len(configuration) > maxDiagnosticConfigBytes {
		return diagnosticWindow{}
	}
	parts := strings.Split(string(configuration), "\n")
	if len(parts) != 4 || parts[0] != diagnosticConfigVersion || parts[3] != "" ||
		!isCanonicalUnixSeconds(parts[1]) || !isCanonicalUnixSeconds(parts[2]) {
		return diagnosticWindow{}
	}
	notBeforeUnix, notBeforeError := strconv.ParseInt(parts[1], 10, 64)
	expiresUnix, expiresError := strconv.ParseInt(parts[2], 10, 64)
	if notBeforeError != nil || expiresError != nil || notBeforeUnix <= 0 || expiresUnix <= notBeforeUnix ||
		expiresUnix-notBeforeUnix > maxDiagnosticWindowSeconds {
		return diagnosticWindow{}
	}
	return diagnosticWindow{notBeforeUnix: notBeforeUnix, expiresUnix: expiresUnix}
}

func isCanonicalUnixSeconds(value string) bool {
	if len(value) == 0 || len(value) > 10 || value[0] == '0' {
		return false
	}
	for index := range value {
		if value[index] < '0' || value[index] > '9' {
			return false
		}
	}
	return true
}

func (window diagnosticWindow) enabledAt(nowUnix int64) bool {
	return window.configured() && nowUnix >= window.notBeforeUnix && nowUnix < window.expiresUnix
}

func (window diagnosticWindow) configured() bool {
	return window.notBeforeUnix > 0 && window.expiresUnix > window.notBeforeUnix
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
