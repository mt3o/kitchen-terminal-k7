# k7-audiometer-rework

status: open
created: 2026-09-10

## Goal
Rework the audiometer's percent metric to be relative to a trailing
30-second loudness window (peak-hold with falloff, capped at 100%)
instead of a fixed absolute RMS-to-percent scale, and add a raw dB
readout alongside the primary level.

memory_goal: 08e87a7d-af86-4011-a637-184af086d75a
