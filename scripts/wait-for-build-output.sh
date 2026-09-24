#!/usr/bin/env bash
# Waits until the "Build with 22.x" job of this workflow run has saved the
# Next.js build output the E2E shards restore, then exits 0.
#
# Why this exists: the E2E shards used to `needs: [build]`, so each one sat
# idle for the whole build and only then spent about 70s pulling the
# Playwright image, starting Postgres and restoring node_modules. Now a shard
# does all of that while the build runs, and this script is the only thing
# that waits (#631).
#
# It watches the build job's "Cache Next.js build output" step rather than
# the job itself, so a shard doesn't also wait on the job's post-steps, which
# save the webpack cache and take 12–26s.
#
# It exits non-zero, so the shard fails fast, when:
#   - the build job finished without saving the output (the build failed, was
#     cancelled, or the save step was skipped);
#   - WAIT_TIMEOUT_SECONDS passes first.
#
# A re-run of only the failed E2E jobs happens in a new run attempt, where the
# build job from the earlier attempt is not listed. The saved output is still
# in the cache under the same key, so the script checks the cache directly
# before it looks at jobs.
#
# Needs: GH_TOKEN (with actions: read), GITHUB_REPOSITORY, GITHUB_RUN_ID,
# GITHUB_RUN_ATTEMPT, GITHUB_REF, and BUILD_OUTPUT_CACHE_KEY. Runs on the
# runner host, which has gh and jq.

set -euo pipefail

readonly BUILD_JOB_NAME='Build with 22.x'
readonly SAVE_STEP_NAME='Cache Next.js build output'
readonly POLL_SECONDS=10
readonly LISTING_GRACE_ROUNDS=3
readonly MAX_API_FAILURES=6
readonly timeout_seconds="${WAIT_TIMEOUT_SECONDS:-900}"
listing_rounds=0
api_failures=0

# Prints "yes" when the build output is already in the cache for this ref,
# "no" when it isn't, and "error" when the cache list could not be read. The
# error's own message goes to stderr, so it lands in the job log.
build_output_is_cached() {
  local key="$1"
  local ref="$2"
  local found
  if ! found=$(gh cache list --repo "$GITHUB_REPOSITORY" --key "$key" --ref "$ref" --limit 100 --json key --jq \
    "map(select(.key == \"$key\")) | length"); then
    echo "::warning::Could not read the cache list; will look at the build job instead." >&2
    echo error
    return
  fi
  if [ "$found" != "0" ]; then echo yes; else echo no; fi
}

# Prints the build job's state as "<job status> <job conclusion> <save step conclusion>",
# with "none" for anything not reported yet, or "missing" when this attempt has
# no build job.
build_job_state() {
  gh api "repos/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID/attempts/$GITHUB_RUN_ATTEMPT/jobs?per_page=100" \
    --jq "[.jobs[] | select(.name == \"$BUILD_JOB_NAME\")] | first
      | if . == null then \"missing\"
        else \"\(.status) \(.conclusion // \"none\") \(([.steps[]? | select(.name == \"$SAVE_STEP_NAME\")] | first | .conclusion) // \"none\")\"
        end"
}

started_at=$SECONDS
while true; do
  if [ "$(build_output_is_cached "$BUILD_OUTPUT_CACHE_KEY" "$GITHUB_REF")" = yes ]; then
    echo "Build output is cached under $BUILD_OUTPUT_CACHE_KEY after $((SECONDS - started_at))s."
    exit 0
  fi

  # A failed API call is retried, since one blip should not fail a shard, but
  # not forever: a call that keeps failing (a bad token, a run attempt that
  # does not exist) fails the shard after MAX_API_FAILURES rounds in a row.
  if state=$(build_job_state); then
    api_failures=0
  else
    api_failures=$((api_failures + 1))
    state="unknown"
    if [ "$api_failures" -ge "$MAX_API_FAILURES" ]; then
      # gh has already printed the API's own message (a 404, a 403, a rate
      # limit) above this line, which is what tells a reader what to fix.
      echo "::error::Could not read this run's jobs from the GitHub API $api_failures times in a row; the gh error above says why."
      exit 1
    fi
  fi
  read -r job_status job_conclusion save_conclusion <<<"$state"

  if [ "$save_conclusion" = success ]; then
    # The step can report success a moment before the cache listing shows
    # the entry, so give the listing a few rounds. If it still doesn't show,
    # hand over anyway: the restore step after this one fails loudly on a
    # real miss, which says more than a timeout here would.
    listing_rounds=$((listing_rounds + 1))
    if [ "$listing_rounds" -ge "$LISTING_GRACE_ROUNDS" ]; then
      echo "::warning::The build saved its output but the cache list does not show $BUILD_OUTPUT_CACHE_KEY yet; trying the restore anyway."
      exit 0
    fi
    echo "The build saved its output; waiting for the cache to list it."
  elif [ "$job_status" = completed ]; then
    echo "::error::$BUILD_JOB_NAME finished ($job_conclusion) without saving the build output, so there is nothing to test."
    exit 1
  elif [ "$job_status" = missing ]; then
    echo "::error::This run attempt has no \"$BUILD_JOB_NAME\" job and the build output is not cached under $BUILD_OUTPUT_CACHE_KEY. Re-run the whole workflow."
    exit 1
  fi

  if [ $((SECONDS - started_at)) -ge "$timeout_seconds" ]; then
    echo "::error::Gave up waiting for $BUILD_JOB_NAME after ${timeout_seconds}s (last state: $state)."
    exit 1
  fi
  sleep "$POLL_SECONDS"
done
