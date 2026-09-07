# Long-format data dictionary

| Field | Meaning |
| --- | --- |
| `class_id`, `class_name`, `class_term` | Server export fields used to isolate one class/semester; not needed in a one-transect phone export |
| `record_id` | Stable client-generated transect identifier used for idempotent retries |
| `revision_number` | Current local/server revision counter |
| `original_submission_timestamp` | First time the group initiated submission for this record |
| `last_modified_timestamp` | Most recent client edit time |
| `site`, `trail`, `transect_number` | Transect identifiers entered by the group |
| `observer_names` | Human-readable group member names; not authentication |
| `survey_date`, `start_time`, `end_time` | Original field timing; paper transcription retains the field date |
| `start_*`, `end_*` GPS fields | Optional endpoint latitude, longitude, reported accuracy, and capture timestamp |
| `segment_start_m`, `segment_end_m` | Exact along-trail bounds; valid pairs are 0/1 through 29/30 |
| `segment_label` | Readable segment range, such as `12-13 m` |
| `side` | `left` or `right`, always facing start → end |
| `distance_band_start_m`, `distance_band_end_m` | Perpendicular bounds measured from trail centerline |
| `species_code` | Target code; `UNKNOWN` for questionable plants; blank for non-detection states |
| `survey_status` | `detected`, `surveyed_no_target`, `not_surveyed`, or `incomplete` |
| `observation_note` | Cell and/or unknown-observation note |
| `entry_method` | `digital_field` or `paper_transcription` |
| `transcription_timestamp` | Time a paper record was entered digitally; blank for direct field entry |
| `protocol_version` | Survey-geometry/rules version |
| `species_list_version` | Species configuration version used during entry |
| `sync_status` | Device state in local exports; server view uses `sync_state` |

### Multiple species

Multiple species in the same cell create multiple rows with identical geometry and different `species_code` values. This is intentional. A non-detection, NS, or incomplete cell creates exactly one row with a blank species code.
