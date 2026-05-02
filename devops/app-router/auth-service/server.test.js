const test = require("node:test");
const assert = require("node:assert/strict");

process.env.AUTH_SECRET = "test-secret-do-not-use";
const { _internals } = require("./server");
const { isValidSlug, safeNext, escapeHtml, safeEqual, cookieName, makeSessionToken } =
  _internals;

test("isValidSlug accepts simple slugs", () => {
  for (const slug of ["app", "my-app", "a", "a1", "abc-def-123"]) {
    assert.equal(isValidSlug(slug), true, slug);
  }
});

test("isValidSlug rejects shell, path, and HTML metacharacters", () => {
  const bad = [
    "",
    "-app",
    "app-",
    "App",
    "../etc",
    "a/b",
    "a b",
    "a.b",
    "<script>",
    "x".repeat(33),
    "a;b",
    "a%20b",
    null,
    undefined,
    123,
  ];
  for (const slug of bad) {
    assert.equal(isValidSlug(slug), false, JSON.stringify(slug));
  }
});

test("escapeHtml neutralizes the standard XSS vectors", () => {
  assert.equal(
    escapeHtml(`<img src=x onerror="alert(1)">&'"`),
    "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;&#39;&quot;"
  );
});

test("safeNext keeps the redirect inside the app's path", () => {
  assert.equal(safeNext("dash", "/dash/page?x=1"), "/dash/page?x=1");
});

test("safeNext blocks open redirects to other origins or apps", () => {
  const cases = [
    "//evil.com/x",
    "https://evil.com/x",
    "/other-app/page",
    "javascript:alert(1)",
    "",
    null,
    undefined,
  ];
  for (const next of cases) {
    assert.equal(safeNext("dash", next), "/dash/", JSON.stringify(next));
  }
});

test("safeEqual is constant-time on equal-length inputs and rejects mismatched lengths", () => {
  assert.equal(safeEqual("abcd", "abcd"), true);
  assert.equal(safeEqual("abcd", "abce"), false);
  assert.equal(safeEqual("abc", "abcd"), false);
  assert.equal(safeEqual(undefined, "abcd"), false);
  assert.equal(safeEqual("abcd", null), false);
});

test("cookieName is stable and unique across valid slugs", () => {
  assert.equal(cookieName("my-app"), "oc_auth_my_app");
  assert.equal(cookieName("dash"), "oc_auth_dash");
  // Underscores are not in the slug alphabet, so distinct valid slugs cannot
  // collide via the dash→underscore rewrite.
  assert.notEqual(cookieName("a-b"), cookieName("ab"));
});

test("makeSessionToken depends on slug, password, and secret", () => {
  const t1 = makeSessionToken("a", "pw");
  const t2 = makeSessionToken("a", "pw");
  const t3 = makeSessionToken("b", "pw");
  const t4 = makeSessionToken("a", "px");
  assert.equal(t1, t2, "deterministic");
  assert.notEqual(t1, t3, "slug-scoped");
  assert.notEqual(t1, t4, "password-scoped");
});
