package callbackedge

import (
	"strings"
	"testing"
)

const validStateFixture = "0123456789_abcdefghijklmnopqrstuvwxyz-ABCDE"

func TestSuccessHandoffStripsQueryAndNormalizesShape(t *testing.T) {
	for _, query := range []string{
		"state=" + validStateFixture + "&code=synthetic%2Bcode%3D",
		"state=" + validStateFixture + "&code=synthetic?code",
		"code=synthetic-code&response_type=code&state=r1_" + validStateFixture,
	} {
		handoff, err := ParseForwardedCallback("GET", CallbackPath, query)
		if err != nil || handoff.Denied || handoff.Code == "" || handoff.State == "" {
			t.Fatalf("expected bounded success handoff for %q: %#v %v", query, handoff, err)
		}
	}
}

func TestForwardedHeaderEventAcceptsStructurallyValidBodylessCallback(t *testing.T) {
	handoff, err := ParseForwardedHeaderCallback(
		"GET",
		CallbackPath,
		"state="+validStateFixture+"&code=synthetic-code",
		[][2]string{{"content-length", "0"}},
	)
	if err != nil || handoff.Denied || handoff.Code != "synthetic-code" || handoff.State != validStateFixture {
		t.Fatalf("expected the bodyless forwarded callback to pass the header event: %#v %v", handoff, err)
	}
}

func TestFiniteDiagnosticReasonsNeverContainRequestValues(t *testing.T) {
	tests := []struct {
		query   string
		headers [][2]string
		reason  RejectionReason
	}{
		{query: "state=" + validStateFixture + "&code=synthetic-code", reason: RejectionNone},
		{query: "state=" + validStateFixture + "&code=synthetic-code", headers: [][2]string{{"content-length", "1"}}, reason: RejectionBodyIndicator},
		{query: "state=" + validStateFixture + "&code=x&code=y", reason: RejectionDuplicateKey},
		{query: "state=short&code=synthetic-code", reason: RejectionState},
	}
	for _, test := range tests {
		_, reason := DiagnoseForwardedHeaderCallback("GET", CallbackPath, test.query, test.headers)
		if reason != test.reason {
			t.Fatalf("expected %q, got %q", test.reason, reason)
		}
		if strings.Contains(string(reason), "synthetic") || strings.Contains(string(reason), validStateFixture) {
			t.Fatalf("diagnostic reason exposed request material: %q", reason)
		}
	}
}

func TestEquivalentForwardedTargetRepresentationsAreAccepted(t *testing.T) {
	rawQuery := "state=" + validStateFixture + "&code=" + strings.Repeat("x", 191)
	for _, target := range []struct{ path, query string }{
		{path: CallbackPath, query: rawQuery},
		{path: CallbackPath, query: "?" + rawQuery},
		{path: CallbackPath + "?" + rawQuery, query: rawQuery},
		{path: CallbackPath + "?" + rawQuery, query: "?" + rawQuery},
	} {
		handoff, err := ParseForwardedCallback("GET", target.path, target.query)
		if err != nil || handoff.Code != strings.Repeat("x", 191) || handoff.State != validStateFixture {
			t.Fatalf("expected equivalent forwarded target to pass: %#v %#v %v", target, handoff, err)
		}
	}
}

func TestDeniedHandoffDropsProviderDescription(t *testing.T) {
	handoff, err := ParseForwardedCallback(
		"GET", CallbackPath,
		"error=access_denied&error_description=provider%20text&state="+validStateFixture,
	)
	if err != nil || !handoff.Denied || handoff.Code != "" || handoff.State != validStateFixture {
		t.Fatalf("unexpected denial handoff: %#v %v", handoff, err)
	}
}

func TestMalformedCallbacksFailClosed(t *testing.T) {
	queries := []string{
		"",
		"state=" + validStateFixture,
		"state=" + validStateFixture + "&code=x&code=y",
		"state=" + validStateFixture + "&code=x&state=" + validStateFixture,
		"state=" + validStateFixture + "&code=x&error=denied",
		"state=" + validStateFixture + "&code=x&response_type=token",
		"state=" + validStateFixture + "&code=x&error_description=forbidden",
		"state=" + validStateFixture + "&code=x&scope=forbidden",
		"state=short&code=x",
		"state=" + validStateFixture + "%2F&code=x",
		"state=" + validStateFixture + "&code=encoded%20space",
		"state=" + validStateFixture + "&code=encoded+space",
		"state=" + validStateFixture + "&code=%0d%0aforged",
		"state=" + validStateFixture + "&code=%ZZ",
		"state=" + validStateFixture + "&code=%FF",
		"state=" + validStateFixture + "&code=x#fragment",
		"state=" + validStateFixture + "&code=x\\suffix",
		"state=" + validStateFixture + "&code=x&",
		"state=" + validStateFixture + "&error=",
		"state=" + validStateFixture + "&error=access_denied&error=other",
		"state=" + validStateFixture + "&error=access_denied&error_description=x&error_description=y",
		"state=" + validStateFixture + "&error=access_denied&response_type=code",
		"state=" + validStateFixture + "&code=" + strings.Repeat("x", 192),
		"state=" + validStateFixture + "&code=" + strings.Repeat("x", MaxRawQueryBytes),
	}
	for _, query := range queries {
		if _, err := ParseForwardedCallback("GET", CallbackPath, query); err == nil {
			t.Fatalf("expected malformed callback to fail: %q", query)
		}
	}
	if _, err := ParseForwardedCallback("POST", CallbackPath, "state="+validStateFixture+"&code=x"); err == nil {
		t.Fatal("expected unsupported method to fail")
	}
	for _, target := range []struct{ path, query string }{
		{path: "/", query: "state=" + validStateFixture + "&code=x"},
		{path: CallbackPath + "?state=" + validStateFixture + "&code=x", query: "state=" + validStateFixture + "&code=y"},
		{path: CallbackPath + "?state=" + validStateFixture + "&code=x", query: ""},
	} {
		if _, err := ParseForwardedCallback("GET", target.path, target.query); err == nil {
			t.Fatalf("expected mismatched forwarded target to fail: %#v", target)
		}
	}
}

func TestBodyIndicatorHeadersFailClosed(t *testing.T) {
	for _, headers := range [][][2]string{
		{{"content-length", "1"}},
		{{"content-length", "0"}, {"Content-Length", "0"}},
		{{"transfer-encoding", "chunked"}},
		{{"Transfer-Encoding", "identity"}},
		{{"expect", "100-continue"}},
	} {
		if !HasForbiddenCallbackBodyHeaders(headers) {
			t.Fatalf("expected body-indicator headers to fail: %#v", headers)
		}
		if _, err := ParseForwardedHeaderCallback(
			"GET", CallbackPath, "state="+validStateFixture+"&code=synthetic-code", headers,
		); err == nil {
			t.Fatalf("expected complete forwarded-header contract to fail: %#v", headers)
		}
	}
	for _, headers := range [][][2]string{
		nil,
		{{"content-length", "0"}},
		{{"Content-Length", " 0 "}},
		{{"accept", "text/html"}},
	} {
		if HasForbiddenCallbackBodyHeaders(headers) {
			t.Fatalf("expected bodyless headers to pass: %#v", headers)
		}
		if handoff, err := ParseForwardedHeaderCallback(
			"GET", CallbackPath, "state="+validStateFixture+"&code=synthetic-code", headers,
		); err != nil || handoff.Code != "synthetic-code" {
			t.Fatalf("expected complete forwarded-header contract to pass: %#v %#v %v", headers, handoff, err)
		}
	}
}

func TestOnlyExactQuerylessHealthAndWebhookPassThrough(t *testing.T) {
	if !IsHealthRequest("GET", HealthPath, "") || !IsHealthRequest("HEAD", HealthPath, "") {
		t.Fatal("expected exact health requests to pass")
	}
	if !IsWebhookRequest("POST", WebhookPath, "") {
		t.Fatal("expected exact webhook request to pass")
	}
	for _, input := range []struct{ method, path, query string }{
		{method: "POST", path: HealthPath},
		{method: "GET", path: HealthPath, query: "x=1"},
		{method: "GET", path: WebhookPath},
		{method: "POST", path: WebhookPath, query: "x=1"},
		{method: "POST", path: "/api/integrations/other/webhook"},
	} {
		if IsHealthRequest(input.method, input.path, input.query) || IsWebhookRequest(input.method, input.path, input.query) {
			t.Fatalf("expected noncanonical pass-through to fail: %#v", input)
		}
	}
}
