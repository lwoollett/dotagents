---
name: "fusion360-mcp-cad-builds"
description: "Build, verify, and export parametric Fusion 360 geometry via the fusion360-mcp-server execute_code tool — API gotchas for 2026 Fusion/Part-Design docs, boolean traps, angled-cut and body-move workarounds, and the working export paths"
---

# Building CAD in Fusion 360 via the MCP server

## When
Creating/modifying parametric geometry in Fusion 360 through the fusion360-mcp-server tools — multi-feature parts, keyboard plates, enclosures. Use `fusion360_execute_code` for anything beyond 2-3 features; individual tool calls don't scale.

## Procedure
1. **Probe before building.** This Fusion build differs from docs: `component.bRepBodies` (NOT `.bodies`), features expose no `.bodies`, `Line3D` has no `.direction` (compute from start/end points), `BRepBody` has no `deleteObject()`. First call: `json.dumps({'attrs': [a for a in dir(design.rootComponent)...]})` to confirm the surface.
2. **execute_code is REPL-style**: statements exec'd, last top-level statement eval'd and returned. End every script with a bare `RES` variable set in both the try and except — a trailing try/except block swallows the result AND your own defensive except hides the traceback.
3. **Units are cm internally.** Define `MM = 0.1` and multiply every coordinate/distance (`V(v)` helper for ValueInput).
4. **"Part Design documents can only contain one component"** — 2026 Part-Design docs reject `occurrences.addNewComponent()` AND `constructionPlanes.setByPlane()` ("Environment is not supported"). Work with named BRepBodies in the root component; only native planes (XY + setByOffset) and the YZ/XZ construction planes work.
5. **JOIN merges into EVERY body it touches or pierces** — not just the one you're thinking of. A boss extruded "temporarily tall" through another part fuses the whole design into one body. Rules that prevent it:
   - Build the reference part (e.g. case with its rim) completely first; build the overlapping part LAST as `NewBodyFeatureOperation`.
   - Scope every cut: `ei.participantBodies = [body]` — takes a **Python list**, NOT an ObjectCollection (ObjectCollection → TypeError).
   - Ring/wall pieces that reach another body: extrude NewBody, then `combineFeatures` (set `ci.operation = CUT/JOIN`) into the intended target only.
6. **Angled cuts without angled planes** (Part Design): build a wedge TOOL body — sketch the trapezoid (slope in sketch coords) on the native `yZConstructionPlane`, `setSymmetricExtent`, then combine-CUT it out of the target. **YZ sketch mapping is (u,v) → global (y=v, z=−u)** — derive/verify empirically with a probe body's bbox before trusting any native-plane axis mapping; verify slope direction (z-extent + y-coverage checks) before the cut.
7. **Repositioning bodies**: `root.features.moveFeatures.createInput(ObjectCollection([body]), matrix)` WORKS in Part Design. For rotations about an arbitrary line, build the matrix with `m.setWithCoordinateSystem(origin, xAxis, yAxis, zAxis)` — orthonormal axes, convention-safe (no setWithArray transpose guessing).
8. **Extrude pattern** (works, verified):
   ```python
   def ext(coll, dist_mm, op, start_mm=None, participants=None):
       ei = root.features.extrudeFeatures.createInput(coll, op)
       if start_mm is not None:
           ei.startExtent = adsk.fusion.OffsetStartDefinition.create(V(start_mm))
       ei.setDistanceExtent(False, V(dist_mm))  # negative = -Z direction
       if participants is not None:
           ei.participantBodies = list(participants)
       return root.features.extrudeFeatures.add(ei)
   ```
   Profiles: `sk.profiles.item(i)` by index (ObjectCollection.add(None) crashes if iteration yields null); pick by area via `p.areaProperties().area`.
9. **Verify geometry programmatically** — this catches real bugs:
   - Histogram of cylindrical faces by radius → confirms hole count/size (caught 4 boss holes cutting air inside switch cutouts).
   - bbox per body (×10 for mm), `body.volume` vs hand calculation + hard assertion ranges after risky boolean ops (a failed combine can silently delete the part or barely change it).
   - Position audits: any hole/cutout must sit in solid material — check against the void layout before committing. For tilted/assembled designs, compensate mating-feature positions (e.g. ×cos θ for screw-hole Y under a rotated plate).
10. **Recovery is cheap**: the deterministic pattern is `delete_all` + full rebuild script from scratch — keep the whole build as one idempotent script rather than surgically editing timeline features.
11. **Export matrix** (this build):
    - `createSTEPExportOptions(path, body)` → RuntimeError "invlid argument geometry" (broken, even with ObjectCollection)
    - `createSTEPExportOptions(path)` (whole design) → works
    - `createSTLExportOptions(body, path)` → works (body is arg 1!), set `sendToFileAsOneBody = True`
    - `document.saveAs` needs a cloud `DataFolder`, not a path — leave saving to the user (Cmd+S)
    - Orient parts in print-ready position in the design itself; exported bodies carry assembly orientation (tilted parts need re-laying in the slicer).
12. **Reverse-engineering reference geometry**: STEP is ASCII — regex `CARTESIAN_POINT` for bboxes/key layouts. Binary STL: extract 36-byte vert chunks per 50-byte record (`b''.join(...)` then `struct.iter_unpack('<9f')` — per-record Python loops time out on ~800KB files).
