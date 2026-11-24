package main

import (
	"net/http"
	"strconv"
	"strings"
	"testing"
)

// Independent review: normalising an IPv4-mapped IPv6 literal must not silently
// admit an authority excluded by policy or equate two distinct browser origins.
func TestReviewBoundaryRejectsUnlistedAuthoritiesAndMalformedOrigins(t *testing.T) {
	env := newBoundaryTestEnv(t)
	port := strconv.Itoa(env.port)
	cases := []struct {
		name   string
		host   string
		origin string
	}{
		{
			name: "IPv4-mapped IPv6 Host is not an explicitly allowed authority",
			host: "[::ffff:127.0.0.1]:" + port,
		},
		{
			name:   "IPv4-mapped IPv6 Origin is not same-origin with IPv4 Host",
			host:   env.validHost(),
			origin: "http://[::ffff:7f00:1]:" + port,
		},
		{
			name:   "Origin with empty fragment is not a serialized origin",
			host:   env.validHost(),
			origin: "http://" + env.validHost() + "#",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var origins []string
			if tc.origin != "" {
				origins = []string{tc.origin}
			}
			resp, body := env.request("GET", "/api/init", tc.host, nil, origins, nil)
			if resp.StatusCode != http.StatusForbidden {
				t.Errorf("Host %q, Origin %q: HTTP %d, want 403", tc.host, tc.origin, resp.StatusCode)
			}
			if strings.Contains(string(body), appToken) {
				t.Error("request forbidden by the documented policy returned the UI token")
			}
			assertSecurityHeaders(t, resp)
		})
	}
}
