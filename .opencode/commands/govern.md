---
description: Run the 7-step Behavior-OS protocol before starting governed work
---

Run the Behavior-OS governance protocol for: $ARGUMENTS

Use the direct `bos_*` tools, not shell commands. Do not edit files in this
command.

1. `bos_whoami` — identify the governed persona or agent acting in this session.
2. `bos_select_dna` — select the pattern that matches the request. If a DNA is
   already active and still matches, keep it instead of switching.
3. `bos_list_dna` — confirm the rules, personas and quality gates that apply.
4. `bos_get_state` — report the active DNA, protocol step, mission and identity.
5. `bos_create_mission` — create one mission with a precise title, type and
   priority. Do not create a duplicate when a mission is already active.
6. `bos_start_mission` — start the mission and confirm the mission ID.
7. Report the active DNA, mission ID, protocol step and the gates that must pass
   before completion.

If a step returns `deny`, report the exact rule and stop. Never retry the same
action or attempt to bypass a governance rule.
