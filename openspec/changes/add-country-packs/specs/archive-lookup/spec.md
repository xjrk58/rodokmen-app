# Spec Delta

## ADDED Requirements

### Requirement: One answer per kind of register
For a location inside a Country pack, the archive answer SHALL list, for each kind of register the pack knows (Catholic, Protestant, Greek Catholic, Orthodox, Jewish, civil), the archive that holds it, its portal and the years it covers where known.

#### Scenario: Czech answer in the new shape
- **WHEN** the reader asks for the archive of a location in the Pardubice district
- **THEN** the answer lists SOA Zámrsk for Catholic registers and the National Archives (Národní archiv) for Jewish registers, as before

#### Scenario: Kind not yet kept
- **WHEN** the answer for a location in Bavaria lists civil registers
- **THEN** the civil entry says that civil registers start in 1876

### Requirement: Outside every Country pack
For a location inside no Country pack, the system SHALL say that no archive lookup is available there and SHALL offer no archive link.

#### Scenario: Location in Hesse
- **WHEN** the reader asks for the archive of a location in Hesse
- **THEN** the system says no archive lookup is available there and offers no archive link

### Requirement: Austria by political district
In the Austria pack, the system SHALL assign every location to the diocesan archive that holds its Catholic registers, by the political district (Bezirk) it lies in. Where a Land is split between dioceses, the districts SHALL decide.

#### Scenario: Linz
- **WHEN** the reader asks for the archive of a location in Linz
- **THEN** the Catholic entry names the Diocese of Linz

#### Scenario: Lower Austria is split
- **WHEN** the reader asks for locations in the Krems (Land) and Mistelbach districts
- **THEN** the Catholic entries name the Diocese of St. Pölten and the Archdiocese of Vienna respectively

#### Scenario: Tyrol east of the Ziller
- **WHEN** the reader asks for a location in the Kufstein district
- **THEN** the Catholic entry names the Archdiocese of Salzburg, not the Diocese of Innsbruck

### Requirement: Poland by county and state in 1900
In the Poland pack, the system SHALL answer by today's county (powiat) together with the state the location belonged to in 1900: the Russian Empire, Austria or the German Empire. A county that the 1900 border crossed SHALL answer differently on each side.

#### Scenario: Former Russian partition
- **WHEN** the reader asks for a location near Łódź
- **THEN** the answer names the State Archive that holds the civil-religious registers there, and notes that entries from 1868 to 1917 are written in Russian

#### Scenario: German until 1945
- **WHEN** the reader asks for a location in Wrocław
- **THEN** the answer says the location belonged to Germany until 1945 and lists the German-era civil registers with the State Archive in Wrocław

#### Scenario: Two sides of the old border
- **WHEN** the reader asks for two villages in one county on either side of the 1900 Russian–German border
- **THEN** the two answers differ, each following its side

### Requirement: Bavaria and Saxony by district
In the Bavaria and Saxony packs, the system SHALL answer by district (Landkreis or kreisfreie Stadt). It SHALL give the Catholic diocese, the Protestant regional church (Landeskirche) and the holder of civil registers from 1876.

#### Scenario: Regensburg
- **WHEN** the reader asks for the archive of a location in Regensburg
- **THEN** the answer lists the Diocese of Regensburg for Catholic registers, the Evangelical Lutheran Church in Bavaria for Protestant registers, and civil registers from 1876

#### Scenario: Leipzig
- **WHEN** the reader asks for the archive of a location in Leipzig
- **THEN** the answer lists the Diocese of Dresden-Meissen for Catholic registers and the Evangelical Lutheran Church of Saxony for Protestant registers

### Requirement: Paid portals are marked
When an archive's portal charges for access, the answer SHALL say so next to the link.

#### Scenario: Paid portal
- **WHEN** an answer links to a portal marked as paid in the pack's archive list
- **THEN** the link is labelled as paid

### Requirement: Near-border hint in every pack
When a location lies within 5 km of a boundary where another archive holds the same kind of register, the answer SHALL name that archive as "also check" for that kind. This includes boundaries between two packs.

#### Scenario: Czech–Austrian border
- **WHEN** the reader opens the place sheet for a location in South Bohemia 3 km from the Austrian border
- **THEN** the Catholic entry names SOA Třeboň and adds "also check" with the Diocese of Linz or St. Pölten, whichever is across the border
