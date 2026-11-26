#!/usr/bin/env bash
# TEMPORARY (#1598): samples memory once a second while the image builds.
# Lives only on the throwaway branch qa/1598-build-memory.
#
# One line per sample, every figure in MB:
#   epoch host_used host_anon swap_used nb_max nb_sum nb_count node_rss cg_peak cg_anon
# host_used  MemTotal - MemAvailable
# host_anon  AnonPages (anonymous memory, no page cache)
# swap_used  SwapTotal - SwapFree
# nb_max     largest RssAnon + VmSwap of any `next-build` process (what dmesg
#            reported as anon-rss on the box that was OOM-killed)
# nb_sum     the same, summed over every `next-build` process
# node_rss   RSS of every node and next-build process, summed
# cg_peak    memory.peak of the cgroup the largest next-build runs in
#            (includes page cache the build writes)
# cg_anon    anon from that cgroup's memory.stat
set -u
out="$1"
while true; do
  read -r used anon swap < <(awk '
    /^MemTotal:/ { total = $2 } /^MemAvailable:/ { avail = $2 } /^AnonPages:/ { an = $2 }
    /^SwapTotal:/ { st = $2 } /^SwapFree:/ { sf = $2 }
    END { printf "%d %d %d\n", (total - avail) / 1024, an / 1024, (st - sf) / 1024 }' /proc/meminfo)
  nb_max=0; nb_sum=0; nb_count=0; biggest_pid=
  for pid in $(pgrep -x next-build); do
    kb=$(awk '/^RssAnon:/ { r = $2 } /^VmSwap:/ { s = $2 } END { print r + s + 0 }' "/proc/${pid}/status" 2>/dev/null || echo 0)
    nb_sum=$(( nb_sum + kb )); nb_count=$(( nb_count + 1 ))
    if [ "${kb}" -gt "${nb_max}" ]; then nb_max=${kb}; biggest_pid=${pid}; fi
  done
  cg_peak=0; cg_anon=0
  if [ -n "${biggest_pid}" ]; then
    cg=$(cut -d: -f3 "/proc/${biggest_pid}/cgroup" 2>/dev/null | head -1)
    if [ -n "${cg}" ] && [ -r "/sys/fs/cgroup${cg}/memory.peak" ]; then
      cg_peak=$(( $(cat "/sys/fs/cgroup${cg}/memory.peak") / 1048576 ))
      cg_anon=$(( $(awk '$1 == "anon" { print $2 }' "/sys/fs/cgroup${cg}/memory.stat") / 1048576 ))
    fi
  fi
  node_rss=$(ps -C node,next-build -o rss= 2>/dev/null | awk '{ s += $1 } END { printf "%d", s / 1024 }')
  echo "$(date +%s) ${used} ${anon} ${swap} $(( nb_max / 1024 )) $(( nb_sum / 1024 )) ${nb_count} ${node_rss} ${cg_peak} ${cg_anon}" >> "${out}"
  sleep 1
done
