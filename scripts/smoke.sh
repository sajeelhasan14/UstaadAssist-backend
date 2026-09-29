#!/usr/bin/env bash
#
# Hit every endpoint once and print the status code.
#
# This is not a substitute for the planner tests — those check that the answers
# are RIGHT. This checks that every route is wired up, reachable, and answers in
# the agreed envelope. It is the quickest way to catch a route that was renamed,
# a router that was never mounted, or a service that throws on an empty course.
#
# Usage:
#   bash scripts/smoke.sh                  # uses course 1
#   bash scripts/smoke.sh 3                # uses course 3
#
# It needs the server running and .env present.

set -u

BASE="${BASE:-http://localhost:4000}"
COURSE="${1:-1}"

SUPA=$(grep -E '^SUPABASE_URL=' .env | cut -d= -f2- | tr -d '"\r')
KEY=$(grep -E '^SUPABASE_SERVICE_ROLE_KEY=' .env | cut -d= -f2- | tr -d '"\r')
EMAIL="${DEMO_EMAIL:-demo.teacher@ustaadassist.test}"
PASSWORD="${DEMO_PASSWORD:-UstaadAssist#Demo2026}"

TOKEN=$(curl -s "$SUPA/auth/v1/token?grant_type=password" \
  -H "apikey: $KEY" -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" \
  | python -c "import sys,json; print(json.load(sys.stdin).get('access_token',''))")

if [ -z "$TOKEN" ]; then
  echo "Could not sign in as $EMAIL."
  echo "Run: node --experimental-strip-types --env-file=.env scripts/create-demo-user.ts"
  exit 1
fi

pass=0
fail=0

# check <expected-status> <method> <path> [json-body]
check() {
  local expected="$1" method="$2" path="$3" body="${4:-}"
  local code

  if [ -n "$body" ]; then
    code=$(curl -s -o /tmp/smoke-body.txt -w '%{http_code}' -X "$method" "$BASE$path" \
      -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "$body")
  else
    code=$(curl -s -o /tmp/smoke-body.txt -w '%{http_code}' -X "$method" "$BASE$path" \
      -H "Authorization: Bearer $TOKEN")
  fi

  if [ "$code" = "$expected" ]; then
    printf '  ok    %-3s %-6s %s\n' "$code" "$method" "$path"
    pass=$((pass + 1))
  else
    printf '  FAIL  %-3s %-6s %s   (wanted %s)\n' "$code" "$method" "$path" "$expected"
    echo "        $(head -c 300 /tmp/smoke-body.txt)"
    fail=$((fail + 1))
  fi
}

echo ""
echo "Smoke test against $BASE, course $COURSE"
echo ""

echo "auth and health"
check 200 GET  /health
check 200 GET  /auth/me

echo ""
echo "rejections (these SHOULD fail)"
# No token at all.
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/auth/me")
if [ "$code" = "401" ]; then
  printf '  ok    401 GET    /auth/me with no token\n'; pass=$((pass + 1))
else
  printf '  FAIL  %s GET    /auth/me with no token   (wanted 401)\n' "$code"; fail=$((fail + 1))
fi
# A URL that does not exist.
check 404 GET  /nothing-here
# Somebody else's course.
check 404 GET  /courses/999999
# A weightage that does not total 100.
check 400 PUT  "/courses/$COURSE/weightage" '{"quiz":10,"final":10}'
# A body that is not valid JSON must be a 400, not a 500.
check 400 POST "/courses/$COURSE/materials" '{"title": broken}'
# Bad input is refused by the route or service that receives it.
check 400 PATCH "/courses/$COURSE" '{}'
check 400 POST "/courses" '{"name":"X","start_date":"01-09-2026","end_date":"2026-12-18","class_days":["mon"]}'
check 400 POST "/courses/$COURSE/assessments" '{"type":"pop-quiz","title":"X","total_marks":10}'
check 400 GET  "/courses/$COURSE/dashboard?today=tomorrow"

echo ""
echo "courses and setup"
check 200 GET  /courses
check 200 GET  "/courses/$COURSE"
check 200 GET  "/courses/$COURSE/holidays"

echo ""
echo "the planner, on the seeded course (already underway)"
# generate refuses once classes have been conducted, and says to replan instead.
check 400 POST "/courses/$COURSE/plan/generate"
check 200 GET  "/courses/$COURSE/sessions"
check 200 POST "/courses/$COURSE/plan/replan" '{"today":"2026-11-18","reason":"smoke test"}'
check 200 GET  "/courses/$COURSE/plan/deficit?today=2026-11-18"

echo ""
echo "the planner, on a throwaway course (the before-the-semester path)"
# A separate course, so plan/generate can be exercised for real without touching
# the demo data. There is no delete endpoint in the API contract and this script
# does not invent one, so it reuses the same SMOKE-1 course on every run instead
# of creating a new one each time.
TEMP=$(curl -s "$BASE/courses" -H "Authorization: Bearer $TOKEN"   | python -c "
import sys, json
courses = json.load(sys.stdin)['data']
match = [c['id'] for c in courses if c.get('code') == 'SMOKE-1']
print(match[0] if match else '')
")

if [ -z "$TEMP" ]; then
  TEMP=$(curl -s -X POST "$BASE/courses"     -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json"     -d '{"name":"Smoke Test Course","code":"SMOKE-1","start_date":"2026-09-01","end_date":"2026-12-18","class_days":["tue","thu"]}'     | python -c "import sys,json; print(json.load(sys.stdin)['data']['id'])")
fi

if [ -n "$TEMP" ]; then
  printf '        created course %s
' "$TEMP"
  check 200 POST "/courses/$TEMP/topics" '{"raw":"Intro\nRelational Model\nSQL\nNormalization"}'
  check 201 POST "/courses/$TEMP/plan/generate" '{"reset":true}'
  check 200 GET  "/courses/$TEMP/sessions"
  check 200 PUT  "/courses/$TEMP/weightage" '{"quiz":20,"assignment":10,"midterm":25,"final":40,"participation":5}'
  check 200 PATCH "/courses/$TEMP" '{"attendance_threshold":80}'
else
  echo "  FAIL  could not create the throwaway course"
  fail=$((fail + 1))
fi

echo ""
echo "students and attendance"
check 200 GET  "/courses/$COURSE/students"
check 200 GET  "/courses/$COURSE/attendance/summary"

echo ""
echo "assessments, marks and grading"
check 200 GET  "/courses/$COURSE/assessments"
check 200 GET  "/courses/$COURSE/weightage"
check 200 GET  "/courses/$COURSE/grade-scale"
check 200 GET  "/courses/$COURSE/results"

echo ""
echo "material, dashboard and reports"
check 200 GET  "/courses/$COURSE/materials"
check 200 GET  "/courses/$COURSE/dashboard?today=2026-11-18"
check 200 GET  "/courses/$COURSE/reports/result?today=2026-11-18"
check 200 GET  "/courses/$COURSE/reports/attendance?today=2026-11-18"
check 200 GET  "/courses/$COURSE/reports/course?today=2026-11-18"
# The PDF renderer is a stub until the tool is chosen, so 503 is the correct answer.
check 503 GET  "/courses/$COURSE/reports/result.pdf"

echo ""
echo "extraction refuses a file outside the teacher's own folder (400 is correct)"
check 400 POST "/courses/$COURSE/students/extract" '{"storage_path":"demo/class-list.jpg"}'
check 400 POST "/courses/$COURSE/outline/import"   '{"storage_path":"demo/outline.pdf"}'

echo ""
echo "  $pass passed, $fail failed"
echo ""

[ "$fail" -eq 0 ]
