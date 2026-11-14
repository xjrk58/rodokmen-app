# Spec Delta

## ADDED Requirements

### Requirement: Merge duplicate Events from the person page
The person page SHALL offer an Editor to merge each pair of the Person's Events that look like one: of one type, with the Person in the same Role in both, and agreeing on every fact a merge of Events checks. It SHALL suggest keeping the Event with more Citations, else the older one, and SHALL show both Events side by side before the Editor merges. Members who are not Editors SHALL NOT see the offer.

#### Scenario: Marriage recorded twice
- **WHEN** an Editor opens the page of Jan Novák, whose marriage to Marie Svobodová is in the Tree twice with the same date and Place, and merges the pair as offered
- **THEN** the page shows both marriages side by side with their Roles and Citations first, the one with more Citations chosen to stay, and afterwards one marriage with the Citations of both

#### Scenario: Two residences in different years
- **WHEN** an Editor opens the page of a Person with a residence in 1840 and another in 1850
- **THEN** the page offers no merge

#### Scenario: Refused after a change
- **WHEN** another Editor dated one of the two marriages otherwise after the page was loaded, and the Editor merges the pair
- **THEN** the page says in the Member's language that the dates differ, and nothing changes

#### Scenario: Contributor sees no offer
- **WHEN** a Contributor opens the page of Jan Novák with his marriage in the Tree twice
- **THEN** both marriages are shown, with no offer to merge them
