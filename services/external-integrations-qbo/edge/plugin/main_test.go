package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/proxy-wasm/proxy-wasm-go-sdk/proxywasm/proxytest"
	"github.com/proxy-wasm/proxy-wasm-go-sdk/proxywasm/types"
	callbackedge "vaeroex.local/qbo-oauth-callback-edge"
)

const allowedTestHost = "qbo.example.test"

func configuredHost(configuration []byte, method, target, query string, requestHost *string) (proxytest.HostEmulator, func()) {
	option := proxytest.NewEmulatorOption().WithVMContext(&vmContext{}).WithPluginConfiguration(configuration).
		WithProperty([]string{"request", "method"}, []byte(method)).
		WithProperty([]string{"request", "path"}, []byte(target)).
		WithProperty([]string{"request", "query"}, []byte(query))
	if requestHost != nil {
		option.WithProperty([]string{"request", "host"}, []byte(*requestHost))
	}
	return proxytest.NewHostEmulator(option)
}

func hostConfiguration(host string) []byte {
	configuration, err := json.Marshal(map[string]string{"allowedHost": host})
	if err != nil {
		panic(err)
	}
	return configuration
}

func callbackHost(t *testing.T, method, query string) (proxytest.HostEmulator, func()) {
	t.Helper()
	requestHost := allowedTestHost
	host, reset := configuredHost(hostConfiguration(allowedTestHost), method, callbackedge.CallbackPath+"?"+query, query, &requestHost)
	if host.StartPlugin() != types.OnPluginStartStatusOK {
		reset()
		t.Fatal("valid host configuration must start the plugin")
	}
	return host, reset
}

func headersByName(headers [][2]string) map[string][]string {
	result := make(map[string][]string)
	for _, header := range headers {
		name := strings.ToLower(header[0])
		result[name] = append(result[name], header[1])
	}
	return result
}

func TestDeniedHandoffClearsForgedHeadersAndQuery(t *testing.T) {
	state := "i1_" + strings.Repeat("a", 43)
	query := "state=" + state + "&error=access_denied"
	host, reset := callbackHost(t, "GET", query)
	defer reset()
	id := host.InitializeHttpContext()
	headers := [][2]string{{":path", callbackedge.CallbackPath + "?" + query}, {"content-length", "0"}}
	for _, name := range callbackedge.ReservedHandoffHeaders {
		headers = append(headers, [2]string{name, "forged"})
	}
	if host.CallOnRequestHeaders(id, headers, true) != types.ActionContinue || host.GetSentLocalResponse(id) != nil {
		t.Fatal("valid denial must forward after clearing forged handoff headers")
	}
	forwarded := headersByName(host.GetCurrentRequestHeaders(id))
	for name, value := range map[string]string{":path": callbackedge.CallbackPath,
		callbackedge.HandoffVersionHeader: callbackedge.DeniedHandoffVersion, callbackedge.HandoffStateHeader: state} {
		if len(forwarded[name]) != 1 || forwarded[name][0] != value {
			t.Fatal("denial handoff field was forged or duplicated")
		}
	}
	if len(forwarded[callbackedge.HandoffCodeHeader]) != 0 || len(forwarded[callbackedge.HandoffRealmIDHeader]) != 0 {
		t.Fatal("denial must never forward code or realm")
	}
}

func TestRejectedCallbacksStripBeforeFixedResponse(t *testing.T) {
	state := "r1_" + strings.Repeat("b", 43)
	for _, query := range []string{
		"state=" + state + "&error=arbitrary_private_error",
		"state=" + state + "&error=access_denied&error_description=private",
		"state=" + state + "&error=access_denied&code=synthetic-code",
	} {
		host, reset := callbackHost(t, "GET", query)
		id := host.InitializeHttpContext()
		action := host.CallOnRequestHeaders(id, [][2]string{{":path", callbackedge.CallbackPath + "?" + query},
			{callbackedge.HandoffStateHeader, "forged"}}, true)
		response := host.GetSentLocalResponse(id)
		forwarded := headersByName(host.GetCurrentRequestHeaders(id))
		if action != types.ActionPause || response == nil || response.StatusCode != 400 || string(response.Data) != "invalid integration callback" ||
			len(forwarded[":path"]) != 1 || forwarded[":path"][0] != callbackedge.CallbackPath || len(forwarded[callbackedge.HandoffStateHeader]) != 0 {
			reset()
			t.Fatal("rejection must strip raw query/header values and return only a fixed message")
		}
		reset()
	}
}

func TestDenialRejectsBodiesAndExcessHeaders(t *testing.T) {
	query := "state=i1_" + strings.Repeat("a", 43) + "&error=access_denied"
	for _, extra := range [][][2]string{
		{{"content-length", "1"}}, {{"transfer-encoding", "chunked"}}, {{"expect", "100-continue"}},
		{{"content-length", "0"}, {"content-length", "0"}},
	} {
		host, reset := callbackHost(t, "GET", query)
		id := host.InitializeHttpContext()
		headers := append([][2]string{{":path", callbackedge.CallbackPath + "?" + query}}, extra...)
		if host.CallOnRequestHeaders(id, headers, true) != types.ActionPause || host.GetSentLocalResponse(id).StatusCode != 400 {
			reset()
			t.Fatal("callback body headers must fail closed")
		}
		reset()
	}
	host, reset := callbackHost(t, "GET", query)
	defer reset()
	id := host.InitializeHttpContext()
	headers := [][2]string{{":path", callbackedge.CallbackPath + "?" + query}}
	for len(headers) <= callbackedge.MaxHeaderCount {
		headers = append(headers, [2]string{fmt.Sprintf("x-padding-%d", len(headers)), "x"})
	}
	if host.CallOnRequestHeaders(id, headers, true) != types.ActionPause || host.GetSentLocalResponse(id).StatusCode != 400 ||
		headersByName(host.GetCurrentRequestHeaders(id))[":path"][0] != callbackedge.CallbackPath {
		t.Fatal("header-count rejection must also strip the query")
	}
}

func TestSuccessStillForwardsOnlyCanonicalHandoff(t *testing.T) {
	state := "i1_" + strings.Repeat("a", 43)
	query := "state=" + state + "&code=synthetic-code&realmId=1"
	host, reset := callbackHost(t, "GET", query)
	defer reset()
	id := host.InitializeHttpContext()
	if host.CallOnRequestHeaders(id, [][2]string{{":path", callbackedge.CallbackPath + "?" + query},
		{callbackedge.HandoffVersionHeader, callbackedge.DeniedHandoffVersion}}, true) != types.ActionContinue {
		t.Fatal("successful callback must remain supported")
	}
	forwarded := headersByName(host.GetCurrentRequestHeaders(id))
	for name, value := range map[string]string{":path": callbackedge.CallbackPath,
		callbackedge.HandoffVersionHeader: callbackedge.HandoffVersion, callbackedge.HandoffCodeHeader: "synthetic-code",
		callbackedge.HandoffStateHeader: state, callbackedge.HandoffRealmIDHeader: "1"} {
		if len(forwarded[name]) != 1 || forwarded[name][0] != value {
			t.Fatal("successful callback contract changed")
		}
	}
}

func TestHeadersOnlyGoogleEdgeDoesNotTreatStreamFlagAsBody(t *testing.T) {
	state := "i1_" + strings.Repeat("a", 43)
	for _, query := range []string{
		"state=" + state + "&error=access_denied",
		"state=" + state + "&code=synthetic-code&realmId=1",
	} {
		for _, end := range []bool{false, true} {
			for _, framing := range [][][2]string{nil, {{"content-length", "0"}}} {
				host, reset := callbackHost(t, "GET", query)
				id := host.InitializeHttpContext()
				headers := append([][2]string{{":path", callbackedge.CallbackPath + "?" + query}}, framing...)
				if host.CallOnRequestHeaders(id, headers, end) != types.ActionContinue || host.GetSentLocalResponse(id) != nil {
					reset()
					t.Fatal("headers-only ABI flag cannot reject an otherwise canonical callback")
				}
				if headersByName(host.GetCurrentRequestHeaders(id))[":path"][0] != callbackedge.CallbackPath {
					reset()
					t.Fatal("callback query must still be stripped")
				}
				reset()
			}
			for _, framing := range [][][2]string{
				{{"content-length", "1"}}, {{"content-length", "-1"}}, {{"content-length", "invalid"}},
				{{"content-length", "0"}, {"content-length", "0"}},
				{{"transfer-encoding", "chunked"}}, {{"expect", "100-continue"}},
			} {
				host, reset := callbackHost(t, "GET", query)
				id := host.InitializeHttpContext()
				headers := append([][2]string{{":path", callbackedge.CallbackPath + "?" + query}}, framing...)
				host.CallOnRequestHeaders(id, headers, end)
				assertSanitizedRejection(t, host, id, 400, "invalid integration callback")
				reset()
			}
		}
	}
}

func TestPluginStartStrictHostConfiguration(t *testing.T) {
	maximumHost := strings.Repeat("a", 63) + "." + strings.Repeat("b", 63) + "." + strings.Repeat("c", 63) + "." + strings.Repeat("d", 61)
	for _, hostName := range []string{allowedTestHost, "QBO.Example.TEST", "qbo-1.example.test", maximumHost} {
		t.Run("valid/"+hostName, func(t *testing.T) {
			host, reset := configuredHost(hostConfiguration(hostName), "GET", callbackedge.CallbackPath, "", &hostName)
			defer reset()
			if host.StartPlugin() != types.OnPluginStartStatusOK {
				t.Fatal("valid DNS configuration rejected")
			}
		})
	}
	invalid := [][]byte{
		nil, {}, []byte(`{}`), []byte(`null`), []byte(`[]`), []byte(`"qbo.example.test"`),
		[]byte(`{"allowedHost":null}`), []byte(`{"allowedHost":true}`), []byte(`{"allowedHost":1}`),
		[]byte(`{"allowedHost":[]}`), []byte(`{"allowedHost":{}}`), []byte(`{"AllowedHost":"qbo.example.test"}`),
		[]byte(`{"allowedHost":"qbo.example.test","unknown":true}`),
		[]byte(`{"unknown":true,"allowedHost":"qbo.example.test"}`),
		[]byte(`{"allowedHost":"qbo.example.test","allowedHost":"qbo.example.test"}`),
		[]byte(`{"allowedHost":"qbo.example.test","ALLOWEDHOST":"other.example.test"}`),
		[]byte(`{"allowedHost":"qbo.example.test"} {}`), []byte(`{"allowedHost":"qbo.example.test"} true`),
		[]byte(`{"allowedHost":"qbo.example.test",}`), []byte(`{"allowedHost":"qbo.example.test"`),
		append(hostConfiguration(allowedTestHost), bytes.Repeat([]byte(" "), maxPluginConfigurationBytes)...),
	}
	for _, hostName := range []string{"", " ", "localhost", "127.0.0.1", "[::1]", "*.example.test", "qbo.example.test.",
		"qbo.example.test:443", "qbo.example.test:80", "https://qbo.example.test", "qbo.example.test/", "qbo.example.test?x",
		"qbo.example.test#x", "user@qbo.example.test", "qbo..example.test", ".qbo.example.test", "-qbo.example.test",
		"qbo-.example.test", "qbo_example.test", " qbo.example.test", "qbo.example.test\r\n", "qbo.example.test\x00",
		"qbo.ex\u00e4mple.test", "qbo.example.test,other.test", strings.Repeat("a", 64) + ".test", "a" + maximumHost} {
		invalid = append(invalid, hostConfiguration(hostName))
	}
	for index, configuration := range invalid {
		t.Run(fmt.Sprintf("invalid/%d", index), func(t *testing.T) {
			requestHost := allowedTestHost
			query := "state=i1_" + strings.Repeat("a", 43) + "&code=synthetic-code&realmId=1"
			host, reset := configuredHost(configuration, "GET", callbackedge.CallbackPath+"?"+query, query, &requestHost)
			defer reset()
			if host.StartPlugin() != types.OnPluginStartStatusFailed {
				t.Fatal("missing or malformed configuration must fail startup")
			}
			id := host.InitializeHttpContext()
			if host.CallOnRequestHeaders(id, [][2]string{{":path", callbackedge.CallbackPath + "?" + query},
				{callbackedge.HandoffStateHeader, "forged"}}, true) != types.ActionPause {
				t.Fatal("failed startup cannot authorize a request")
			}
			assertSanitizedRejection(t, host, id, 500, "integration callback unavailable")
		})
	}
}

func assertSanitizedRejection(t *testing.T, host proxytest.HostEmulator, id uint32, status uint32, body string) {
	t.Helper()
	response := host.GetSentLocalResponse(id)
	if response == nil || response.StatusCode != status || string(response.Data) != body {
		t.Fatal("request must receive only a fixed rejection")
	}
	headers := headersByName(host.GetCurrentRequestHeaders(id))
	if len(headers[":path"]) != 1 || headers[":path"][0] != callbackedge.CallbackPath {
		t.Fatal("rejected callback must have its query stripped")
	}
	for _, name := range callbackedge.ReservedHandoffHeaders {
		if len(headers[name]) != 0 {
			t.Fatal("rejected request retained a handoff header")
		}
	}
}

func TestConfigurationSizeAndFailedReload(t *testing.T) {
	for _, size := range []int{-1, 0, maxPluginConfigurationBytes + 1} {
		plugin := &pluginContext{allowedHost: allowedTestHost}
		if plugin.OnPluginStart(size) != types.OnPluginStartStatusFailed || plugin.allowedHost != "" ||
			plugin.NewHttpContext(1).(*httpContext).allowedHost != "" {
			t.Fatal("invalid configuration size must clear prior authority")
		}
	}
	for _, configuration := range [][]byte{nil, hostConfiguration(allowedTestHost)} {
		host, reset := configuredHost(configuration, "GET", callbackedge.CallbackPath, "unused", nil)
		_ = host
		plugin := &pluginContext{allowedHost: allowedTestHost}
		status := plugin.OnPluginStart(len(configuration) + 1)
		reset()
		if status != types.OnPluginStartStatusFailed || plugin.allowedHost != "" {
			t.Fatal("unavailable or size-mismatched configuration must fail closed")
		}
	}
}

func TestRequestHostAuthority(t *testing.T) {
	query := "state=i1_" + strings.Repeat("a", 43) + "&code=synthetic-code&realmId=1"
	for _, authority := range []string{allowedTestHost, "QBO.Example.TEST", allowedTestHost + ":443", "QBO.Example.TEST:443"} {
		t.Run("allowed/"+authority, func(t *testing.T) {
			host, reset := configuredHost(hostConfiguration("QBO.Example.TEST"), "GET", callbackedge.CallbackPath+"?"+query, query, &authority)
			defer reset()
			if host.StartPlugin() != types.OnPluginStartStatusOK {
				t.Fatal("configured plugin failed to start")
			}
			id := host.InitializeHttpContext()
			if host.CallOnRequestHeaders(id, [][2]string{{":path", callbackedge.CallbackPath + "?" + query}}, true) != types.ActionContinue ||
				host.GetSentLocalResponse(id) != nil {
				t.Fatal("exact DNS host with implicit or explicit HTTPS port must pass")
			}
		})
	}
	for _, authority := range []string{"", "other.example.test", "qbo.example.test.evil.test", "qbo.example.test@evil.test",
		"127.0.0.1", "[::1]", "*.example.test", allowedTestHost + ".", allowedTestHost + ":80", allowedTestHost + ":444",
		allowedTestHost + ":0443", allowedTestHost + ":443:443", allowedTestHost + ":", " " + allowedTestHost,
		allowedTestHost + " ", allowedTestHost + "\r\n", allowedTestHost + "\x00", allowedTestHost + ",other.test",
		"https://" + allowedTestHost, allowedTestHost + "/", allowedTestHost + "?", allowedTestHost + "#",
		"qbo.ex\u00e4mple.test", strings.Repeat("a", 258)} {
		t.Run("rejected/"+authority, func(t *testing.T) {
			host, reset := configuredHost(hostConfiguration(allowedTestHost), "GET", callbackedge.CallbackPath+"?"+query, query, &authority)
			defer reset()
			if host.StartPlugin() != types.OnPluginStartStatusOK {
				t.Fatal("configured plugin failed to start")
			}
			id := host.InitializeHttpContext()
			headers := [][2]string{{":path", callbackedge.CallbackPath + "?" + query}, {"host", allowedTestHost},
				{":authority", allowedTestHost}, {"x-forwarded-host", allowedTestHost}}
			for _, name := range callbackedge.ReservedHandoffHeaders {
				headers = append(headers, [2]string{name, "forged"})
			}
			if host.CallOnRequestHeaders(id, headers, true) != types.ActionPause {
				t.Fatal("host aliases and forged forwarding headers cannot authorize a request")
			}
			if authority == "" {
				// This pinned proxytest panics at &data[0] for an empty property.
				// Verify that even that host failure sanitizes before rejection.
				assertSanitizedRejection(t, host, id, 500, "integration callback unavailable")
			} else {
				assertSanitizedRejection(t, host, id, 400, "invalid integration request")
			}
			if matchesAllowedHost(authority, allowedTestHost) {
				t.Fatal("invalid host value accepted by the authority predicate")
			}
		})
	}
	t.Run("missing-property", func(t *testing.T) {
		host, reset := configuredHost(hostConfiguration(allowedTestHost), "GET", callbackedge.CallbackPath+"?"+query, query, nil)
		defer reset()
		if host.StartPlugin() != types.OnPluginStartStatusOK {
			t.Fatal("configured plugin failed to start")
		}
		id := host.InitializeHttpContext()
		if host.CallOnRequestHeaders(id, [][2]string{{":path", callbackedge.CallbackPath + "?" + query},
			{"host", allowedTestHost}, {":authority", allowedTestHost}}, true) != types.ActionPause {
			t.Fatal("raw headers cannot replace the required forwarded host property")
		}
		assertSanitizedRejection(t, host, id, 500, "integration callback unavailable")
	})
}

func TestWebhookHostAndExactBody(t *testing.T) {
	for _, authority := range []string{allowedTestHost, "QBO.Example.TEST:443", "other.example.test"} {
		t.Run(authority, func(t *testing.T) {
			// proxytest cannot retrieve zero-length property values. The existing
			// target parser accepts "?" as an empty query; also check the raw form.
			if !callbackedge.IsWebhookRequest("POST", callbackedge.WebhookPath, "") {
				t.Fatal("the real empty query must identify the exact webhook")
			}
			host, reset := configuredHost(hostConfiguration(allowedTestHost), "POST", callbackedge.WebhookPath, "?", &authority)
			defer reset()
			if host.StartPlugin() != types.OnPluginStartStatusOK {
				t.Fatal("configured plugin failed to start")
			}
			id := host.InitializeHttpContext()
			body := []byte(" {\n \"eventNotifications\" : [] }\r\n")
			headers := [][2]string{{":path", callbackedge.WebhookPath}, {"intuit-signature", "synthetic-signature"},
				{"content-length", fmt.Sprint(len(body))}, {callbackedge.HandoffCodeHeader, "forged"}}
			action := host.CallOnRequestHeaders(id, headers, false)
			if authority == "other.example.test" {
				response := host.GetSentLocalResponse(id)
				if action != types.ActionPause || response == nil || response.StatusCode != 400 {
					t.Fatal("webhook must not bypass configured host authority")
				}
				return
			}
			if action != types.ActionContinue || host.GetSentLocalResponse(id) != nil {
				t.Fatal("valid webhook must pass without callback body restrictions")
			}
			forwarded := headersByName(host.GetCurrentRequestHeaders(id))
			if len(forwarded[callbackedge.HandoffCodeHeader]) != 0 || forwarded[":path"][0] != callbackedge.WebhookPath ||
				forwarded["intuit-signature"][0] != "synthetic-signature" || forwarded["content-length"][0] != fmt.Sprint(len(body)) {
				t.Fatal("webhook path/signature/framing must be preserved and handoff headers cleared")
			}
			var forwardedBody []byte
			for index, chunk := range [][]byte{body[:7], body[7:]} {
				if host.CallOnRequestBody(id, chunk, index == 1) != types.ActionContinue {
					t.Fatal("webhook body must pass through unchanged")
				}
				forwardedBody = append(forwardedBody, host.GetCurrentRequestBody(id)...)
			}
			if !bytes.Equal(forwardedBody, body) {
				t.Fatal("webhook raw bytes changed")
			}
		})
	}
}

func TestWebhookQueryCannotBypassSanitization(t *testing.T) {
	authority := allowedTestHost
	query := "code=synthetic-private-value"
	host, reset := configuredHost(hostConfiguration(allowedTestHost), "POST", callbackedge.WebhookPath+"?"+query, query, &authority)
	defer reset()
	if host.StartPlugin() != types.OnPluginStartStatusOK {
		t.Fatal("configured plugin failed to start")
	}
	id := host.InitializeHttpContext()
	if host.CallOnRequestHeaders(id, [][2]string{{":path", callbackedge.WebhookPath + "?" + query},
		{callbackedge.HandoffCodeHeader, "forged"}}, false) != types.ActionPause {
		t.Fatal("webhook accepts only its exact queryless route")
	}
	assertSanitizedRejection(t, host, id, 400, "invalid integration callback")
}
