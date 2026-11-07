import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assessEnvDns,
  assessEnvWebRtc,
} from "../src/views/env/network-assessment.ts";

const ipv4 = { ip: "1.1.1.1", country_code: "US" };
const ipv6 = { ip: "2606:4700:4700::1111", country_code: "CA" };
const dualStack = { ipv4, ipv6 };
const v4Only = { ipv4, ipv6: null };

test("WebRTC compares public candidates against HTTP within each family", () => {
  const mapped = { ip: "::ffff:1.1.1.1", public: true };
  const expanded = { ip: "2606:4700:4700:0:0:0:0:1111", public: true };
  const other = { ip: "2606:4700:4700::1001", public: true };
  assert.equal(assessEnvWebRtc([mapped, expanded], dualStack).severity, "normal");
  const mixed = assessEnvWebRtc([mapped, expanded, other], dualStack);
  assert.equal(mixed.severity, "warning");
  assert.deepEqual(mixed.matches, [mapped, expanded]);
  assert.deepEqual(mixed.mismatches, [other]);
  assert.deepEqual(mixed.unverified, []);
});

test("a candidate without a same-family HTTP baseline stays unverified", () => {
  const v4Candidate = { ip: ipv4.ip, public: true };
  const v6Candidate = { ip: ipv6.ip, public: true };
  const onlyUnknown = assessEnvWebRtc([v6Candidate], v4Only);
  assert.equal(onlyUnknown.severity, "unavailable");
  assert.deepEqual(onlyUnknown.unverified, [v6Candidate]);
  assert.deepEqual(onlyUnknown.mismatches, []);
  const partial = assessEnvWebRtc([v4Candidate, v6Candidate], v4Only);
  assert.equal(partial.severity, "warning");
  assert.deepEqual(partial.matches, [v4Candidate]);
  assert.deepEqual(partial.unverified, [v6Candidate]);
});

test("only concrete private ICE addresses count as local exposure", () => {
  const masked = [
    { ip: "masked.local", public: false },
    { ip: "0.0.0.0", public: false },
    { ip: "::1", public: false },
    { ip: "1.0.0.1", public: true, kind: "relay" },
  ];
  assert.equal(assessEnvWebRtc(masked, dualStack).severity, "unavailable");
  const result = assessEnvWebRtc(
    [
      ...masked,
      { ip: "::ffff:192.168.1.2", public: false },
      { ip: "192.168.1.2", public: false },
      { ip: "fd00::3", public: false },
    ],
    dualStack,
  );
  assert.equal(result.severity, "warning");
  assert.deepEqual(result.localExposed, ["192.168.1.2", "fd00::3"]);
  assert.deepEqual(result.mismatches, []);
});

test("DNS accepts the country of either observed HTTP egress", () => {
  const resolver = { ip: "8.8.8.8", country: "ca" };
  const sample = { results: [resolver], count: 4, failed: 0 };
  assert.equal(assessEnvDns(sample, dualStack).severity, "normal");
  const oneCountry = assessEnvDns(sample, v4Only);
  assert.equal(oneCountry.severity, "warning");
  assert.deepEqual(oneCountry.mismatches, [resolver]);
});

test("DNS exposes partial sampling and distinguishes unavailable evidence", () => {
  const resolver = { ip: "8.8.8.8", country: "US" };
  const partial = assessEnvDns(
    { results: [resolver, { ip: "8.8.4.4" }], count: 4, failed: 2 },
    v4Only,
  );
  assert.equal(partial.severity, "warning");
  assert.equal(partial.successful, 2);
  assert.equal(partial.failed, 2);
  assert.equal(partial.unknown, 1);
  const allFailed = assessEnvDns({ results: [], count: 4, failed: 4 }, v4Only);
  assert.equal(allFailed.severity, "unavailable");
  assert.equal(allFailed.successful, 0);
  assert.equal(
    assessEnvDns({ results: [resolver], count: 4, failed: 0 }, {
      ipv4: { ...ipv4, country_code: "XX" },
      ipv6: null,
    }).severity,
    "unavailable",
  );
});
