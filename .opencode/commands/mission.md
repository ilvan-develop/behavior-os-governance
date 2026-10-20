---
description: Create and start a Behavior-OS mission for the current work
---

Create and start a mission for: $ARGUMENTS

1. `bos_get_state` — check whether a mission is already active. Do not create a
   duplicate.
2. If no mission is active, `bos_create_mission` with a precise title, type and
   priority.
3. `bos_start_mission` with the returned mission ID.
4. Report the mission ID, type, priority, active DNA and protocol step.

Use `bos_list_missions` when you need to check for an existing mission with the
same scope. Do not edit files in this command.
