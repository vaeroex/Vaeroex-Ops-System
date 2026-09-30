package main

import (
	"bytes"
	"encoding/json"
	"io"
	"strings"

	callbackedge "vaeroex.local/qbo-oauth-callback-edge"

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
	allowedHost string
}
type httpContext struct {
	types.DefaultHttpContext
	allowedHost string
}

const maxPluginConfigurationBytes = 1024

func (*vmContext) NewPluginContext(uint32) types.PluginContext { return &pluginContext{} }
func (p *pluginContext) NewHttpContext(uint32) types.HttpContext {
	return &httpContext{allowedHost: p.allowedHost}
}

func (p *pluginContext) OnPluginStart(size int) (status types.OnPluginStartStatus) {
	p.allowedHost = ""
	status = types.OnPluginStartStatusFailed
	defer func() {
		if recover() != nil {
			p.allowedHost = ""
			status = types.OnPluginStartStatusFailed
		}
	}()
	if size <= 0 || size > maxPluginConfigurationBytes {
		return status
	}
	configuration, err := proxywasm.GetPluginConfiguration()
	defer zeroBytes(configuration)
	if err != nil || len(configuration) != size {
		return status
	}
	host, valid := parseAllowedHost(configuration)
	if !valid {
		return status
	}
	p.allowedHost = host
	return types.OnPluginStartStatusOK
}

func parseAllowedHost(configuration []byte) (string, bool) {
	if len(configuration) == 0 || len(configuration) > maxPluginConfigurationBytes {
		return "", false
	}
	decoder := json.NewDecoder(bytes.NewReader(configuration))
	start, err := decoder.Token()
	if err != nil || start != json.Delim('{') {
		return "", false
	}
	key, err := decoder.Token()
	if err != nil || key != "allowedHost" {
		return "", false
	}
	var host string
	if decoder.Decode(&host) != nil || !validDNSHost(host) {
		return "", false
	}
	// Token decoding rejects duplicate/case-aliased fields, unlike struct decoding.
	end, err := decoder.Token()
	if err != nil || end != json.Delim('}') {
		return "", false
	}
	if _, err = decoder.Token(); err != io.EOF {
		return "", false
	}
	return strings.ToLower(host), true
}

func validDNSHost(host string) bool {
	if len(host) == 0 || len(host) > 253 {
		return false
	}
	labels := strings.Split(host, ".")
	if len(labels) < 2 {
		return false
	}
	for _, label := range labels {
		if len(label) == 0 || len(label) > 63 || label[0] == '-' || label[len(label)-1] == '-' {
			return false
		}
		for index := 0; index < len(label); index++ {
			c := label[index]
			if !((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-') {
				return false
			}
		}
	}
	// A DNS hostname has a nonnumeric final label; IP literals are never authority.
	return strings.IndexAny(labels[len(labels)-1], "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ") >= 0
}

func matchesAllowedHost(requestHost, allowedHost string) bool {
	if allowedHost == "" || len(requestHost) > 257 {
		return false
	}
	host, port, hasPort := strings.Cut(requestHost, ":")
	if hasPort && port != "443" {
		return false
	}
	// DNS case is insignificant; only the default HTTPS port may be explicit.
	return validDNSHost(host) && strings.EqualFold(host, allowedHost)
}

func (h *httpContext) OnHttpRequestHeaders(headerCount int, endOfStream bool) (action types.Action) {
	action = types.ActionPause
	defer func() {
		if recover() != nil {
			proxywasm.ReplaceHttpRequestHeader(":path", callbackedge.CallbackPath)
			clearReservedHandoffHeaders()
			sendFixedResponse(500, "integration callback unavailable")
		}
	}()
	method, methodError := proxywasm.GetProperty([]string{"request", "method"})
	path, pathError := proxywasm.GetProperty([]string{"request", "path"})
	rawQuery, queryError := proxywasm.GetProperty([]string{"request", "query"})
	requestHost, hostError := proxywasm.GetProperty([]string{"request", "host"})
	defer zeroBytes(method)
	defer zeroBytes(path)
	defer zeroBytes(rawQuery)
	defer zeroBytes(requestHost)
	webhook := methodError == nil && pathError == nil && queryError == nil &&
		callbackedge.IsWebhookRequest(string(method), string(path), string(rawQuery))
	// Preserve the raw attributes only in memory. Strip callback queries and
	// caller-forged handoff headers before either forwarding or fixed rejection.
	pathSanitized := webhook || proxywasm.ReplaceHttpRequestHeader(":path", callbackedge.CallbackPath) == nil
	headersCleared := clearReservedHandoffHeaders()
	if !pathSanitized || !headersCleared {
		sendFixedResponse(500, "integration callback unavailable")
		return action
	}
	if methodError != nil || pathError != nil || queryError != nil || hostError != nil || h.allowedHost == "" {
		sendFixedResponse(500, "integration callback unavailable")
		return action
	}
	if headerCount > callbackedge.MaxHeaderCount {
		sendFixedResponse(400, "invalid integration request")
		return action
	}
	if !matchesAllowedHost(string(requestHost), h.allowedHost) {
		sendFixedResponse(400, "invalid integration request")
		return action
	}
	if webhook {
		return types.ActionContinue
	}
	if hasForbiddenCallbackBodyHeaders() {
		sendFixedResponse(400, "invalid integration callback")
		return action
	}
	handoff, err := callbackedge.ParseForwardedCallback(
		string(method), string(path), string(rawQuery), endOfStream,
	)
	if err != nil {
		sendFixedResponse(400, "invalid integration callback")
		return action
	}
	version := callbackedge.HandoffVersion
	if handoff.Denied {
		version = callbackedge.DeniedHandoffVersion
	}
	if proxywasm.AddHttpRequestHeader(callbackedge.HandoffVersionHeader, version) != nil ||
		proxywasm.AddHttpRequestHeader(callbackedge.HandoffStateHeader, handoff.State) != nil {
		sendFixedResponse(500, "integration callback unavailable")
		return action
	}
	if !handoff.Denied && (proxywasm.AddHttpRequestHeader(callbackedge.HandoffCodeHeader, handoff.Code) != nil ||
		proxywasm.AddHttpRequestHeader(callbackedge.HandoffRealmIDHeader, handoff.RealmID) != nil) {
		sendFixedResponse(500, "integration callback unavailable")
		return action
	}
	return types.ActionContinue
}

func hasForbiddenCallbackBodyHeaders() bool {
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
		// REQUEST_HEADERS pause alone is not a managed-edge rejection boundary.
		// Propagate a failed local reply so the extension's fail_open=false applies.
		panic(err)
	}
}
