# Comparison demonstration

The built-in demo uses illustrative phone numbers and local identities. It is not connected to a real group.

| Case | Expected result | Resolution |
| --- | --- | --- |
| UK 07700 900101 vs +44 (0)7700 900101 | On supplied list | Normalise to the same number |
| An unmatched valid number | Needs checking | Verify with organiser; do not infer ineligibility |
| An opaque identity without a phone | Number unavailable | Obtain a verified identity-to-number mapping |
| Duplicate approved number in two records | Ambiguous | Resolve duplicate source entries, then reimport |
| New number for approved reference DEMO-B | Changed number verified | Demo organiser note links the current participant; original list retained |
| 00447700900103 vs +44 7700 900103 | On supplied list | Explicit international-prefix normalisation |
| Guest not in the list | Needs checking until reviewed | Record guest exception, note and optional expiry |
| Exception expires or approved list changes | Review needed again | Fresh comparison and organiser decision |
| Membership actor differs from target | Check state_key identity | Never attach the admin's number to the joining member |
| Duplicate membership event | No duplicate participant | Persist event deduplication keys |
| Leave/ban observation | Outside current comparison | Record observation only; app performs no removal |

False positives to investigate with the organiser include changed numbers, family/shared numbers, stale lists and bridge identities with no exposed number. A formatted-number match alone cannot prove the person controls that number. Default decisions remain reviewable; no automatic public response or removal is made.
