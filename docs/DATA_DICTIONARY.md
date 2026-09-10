# Long-format data dictionary

The phone CSV and server view use one row for each non-detection cell and one row per observation in a detected cell. Use the geometry columns—not row count—to count the 180 unique sampling cells.

| Field | Meaning |
| --- | --- |
| `class_id`, `class_name`, `class_term` | Server-only fields used to select a class/semester |
| `record_id` | Stable client-generated transect ID used for idempotent retry/edit |
| `revision_number` | Current revision/submission counter |
| `original_submission_timestamp` | First submission attempt retained across edits |
| `last_modified_timestamp` | Most recent client edit time |
| `site`, `trail`, `transect_number` | Group-entered transect identifiers |
| `observer_names` | Group names; descriptive metadata, not authentication |
| `survey_date`, `start_time`, `end_time` | Field date and times |
| `start_latitude`, `start_longitude`, `start_accuracy_m`, `start_gps_timestamp` | Optional start endpoint GPS and phone-reported accuracy |
| `end_latitude`, `end_longitude`, `end_accuracy_m`, `end_gps_timestamp` | Optional end endpoint GPS and phone-reported accuracy |
| `segment_start_m`, `segment_end_m` | Along-trail bounds: 0/1 through 29/30 only |
| `segment_label` | Readable range such as `12-13 m` |
| `side` | `left` or `right`, fixed while facing start → end |
| `distance_band_start_m`, `distance_band_end_m` | Perpendicular bounds from centerline: 0/1, 1/2, or 2/3 |
| `species_code` | A current target code, `UNKNOWN`, or blank for a non-detection state |
| `survey_status` | `detected`, `surveyed_no_target`, `not_surveyed`, or `incomplete` |
| `observation_note` | Combined relevant cell/unknown note in long export |
| `entry_method` | `digital_field` in the current workflow |
| `schema_version` | JSON/export schema; current value `2` |
| `protocol_version` | Geometry/rules version; current value `2.0.0` |
| `species_list_version` | Catalog version used for entry; current value `reno-2026.1` |
| `sync_status` | Local or server submission state |

## Status interpretation

| Status | Ecological meaning | Species code |
| --- | --- | --- |
| `detected` | At least one target or unknown was recorded | One target code or `UNKNOWN` per exported row |
| `surveyed_no_target` | Cell was surveyed and no target was detected (`0`) | Blank |
| `not_surveyed` | Cell was intentionally not surveyed (`NS`) | Blank |
| `incomplete` | Cell has no completed status | Blank |

`completed` in the interface means any non-incomplete status. `surveyed cells` means only `detected + surveyed_no_target`; it excludes `NS`.

## Reconstructing effort

The unique cell key is:

```text
record_id + segment_start_m + side + distance_band_start_m
```

Group by that key before counting effort. Two targets in one cell share the key and intentionally create two rows. See `data/sample_long_format.csv` for detections, multiple targets, zero, NS, incomplete, unknown, GPS, and an edited record.
