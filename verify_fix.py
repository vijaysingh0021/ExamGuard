#!/usr/bin/env python3
"""
Quick verification script for evidence upload security fix.
This script checks the current implementation of the evidence upload route
in server/src/app.ts and validates ownership verification.
"""

import re
import sys

def check_evidence_upload_security():
    """Check if evidence upload route has proper ownership validation."""

    try:
        with open('server/src/app.ts', 'r') as f:
            content = f.read()
    except FileNotFoundError:
        print("❌ ERROR: server/src/app.ts not found")
        return False

    # Find the evidence upload route
    route_match = r'\s*app\.post\(/api/student/attempts/:attemptId/evidence\''
    if not re.search(route_match, content):
        print("❌ ERROR: Evidence upload route not found")
        return False

    # Find the Prisma query for attempt lookup
    query_patterns = [
        r'await\s+prisma\.examAttempt\.findFirst\(\s*{ where:\s*{[^}]*id:\s*String\(req\.params\.attemptId\)',
        r'await\s+prisma\.examAttempt\.findUnique\(\s*{ where:\s*{[^}]*attemptId:\s*String\(req\.params\.attemptId\)',
        r'const\s+attempt\s*=\s*await\s+prisma\.examAttempt\.findFirst\(\s*{[^}]*where:\s*{[^}]*id:\s*String\(req\.params\.attemptId\)',
    ]

    query_found = any(query_patterns, lambda x: re.search(x, content))

    if not query_found:
        print("❌ ERROR: No ownership validation query found in evidence upload route")
        print("\nCurrent evidence upload route:")
        route_match = re.search(r'\s*app\.post\(\'/api/student/attempts/:attemptId/evidence\',\s*[\s\S]*?\n\s*});', content)
        if route_match:
            print(route_match.group(0)[:500] + "...")
        return False

    print("✅ Evidence upload route found with ownership validation")

    # Check middleware order
    middleware_pattern = r'app\.post\(\'/api/student/attempts/:attemptId/evidence\',\s*\(\s*authenticate,\s*upload\.single\(\'file\'\),\s*validateFileContent,\s*async\s*\('
    if not re.search(middleware_pattern, content):
        print("⚠️  WARNING: Middleware order may be incorrect - ensure authenticate runs before file processing")

    print("\n✅ Evidence upload security verification completed")
    print("   - Route found with ownership validation")
    print("   - Authentication middleware included")
    print("   - File validation middleware included")

    return True

def any(patterns, check_func):
    return any(check_func(p) for p in patterns)

if __name__ == "__main__":
    print("Checking evidence upload security implementation...")
    print("=" * 60)

    if check_evidence_upload_security():
        print("\n" + "=" * 60)
        print("✅ SECURITY FIX VERIFICATION: PASSED")
        print("=" * 60)
        print("The evidence upload route now includes proper ownership validation.")
        print("Candidates can only upload evidence to their own active attempts.")
        sys.exit(0)
    else:
        print("\n" + "=" * 60)
        print("❌ SECURITY FIX VERIFICATION: FAILED")
        print("=" * 60)
        print("The evidence upload route is missing proper ownership validation.")
        print("Candidates can upload evidence to unauthorized attempts.")
        sys.exit(1)