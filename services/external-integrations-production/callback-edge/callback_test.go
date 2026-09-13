package callbackedge

import "testing"

const validStateFixture = "0123456789_abcdefghijklmnopqrstuvwxyz-ABCDE"

func TestSuccessHandoffStripsQueryAndNormalizesShape(t *testing.T) {
	for _, query := range []string{
		"state=" + validStateFixture + "&code=synthetic%2Bcode%3D",
		"state=" + validStateFixture + "&code=synthetic?code",
		"code=synthetic-code&response_type=code&state=r1_" + validStateFixture,
	} {
		handoff, err := ParseForwardedCallback("GET", CallbackPath, query, true)
		if err != nil || handoff.Denied || handoff.Code == "" || handoff.State == "" {
			t.Fatalf("expected bounded success handoff for %q: %#v %v", query, handoff, err)
		}
	}
}

func TestDeniedHandoffDropsProviderDescription(t *testing.T) {
	handoff, err := ParseForwardedCallback(
		"GET", CallbackPath,
		"error=access_denied&error_description=provider%20text&state="+validStateFixture,
		true,
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
		"state=" + validStateFixture + "&code=x&error=denied",
		"state=" + validStateFixture + "&code=x&response_type=token",
		"state=" + validStateFixture + "&code=x&error_description=forbidden",
		"state=" + validStateFixture + "&code=x&scope=forbidden",
		"state=short&code=x",
		"state=" + validStateFixture + "&code=encoded%20space",
		"state=" + validStateFixture + "&code=%0d%0aforged",
	}
	for _, query := range queries {
		if _, err := ParseForwardedCallback("GET", CallbackPath, query, true); err == nil {
			t.Fatalf("expected malformed callback to fail: %q", query)
		}
	}
	if _, err := ParseForwardedCallback("POST", CallbackPath, "state="+validStateFixture+"&code=x", true); err == nil {
		t.Fatal("expected unsupported method to fail")
	}
	if _, err := ParseForwardedCallback("GET", CallbackPath, "state="+validStateFixture+"&code=x", false); err == nil {
		t.Fatal("expected request body to fail")
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
