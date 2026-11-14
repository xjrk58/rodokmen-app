# Spec Delta

## ADDED Requirements

### Requirement: Map lines between Places
For signed-in Members, the family map SHALL draw Map lines: a generation line from where a parent was born to where their child was born, and a marriage line between where two partners who married were born. A line whose two ends are the same point SHALL NOT be drawn. A child SHALL count once on a line, even when both parents were born at its start.

#### Scenario: A son born in another village
- **WHEN** Karel Novák was born in Vrbinov and his son Jan was born in Habrová Lhota in 1834
- **THEN** a generation line runs from Vrbinov to Habrová Lhota, dated 1834

#### Scenario: A marriage between two villages
- **WHEN** Jan Novák, born in Habrová Lhota, married Anna Dvořáková, born in Vrbinov, in 1858
- **THEN** a marriage line joins Habrová Lhota and Vrbinov, dated 1858

#### Scenario: Born where the parent was born
- **WHEN** a daughter was born in the village where her mother was born, and neither birth has a House with its own position
- **THEN** no line is drawn for them

#### Scenario: Both parents from one village
- **WHEN** both parents of a child were born in Vrbinov and the child in Habrová Lhota
- **THEN** one generation line runs from Vrbinov to Habrová Lhota, and it counts the child once

#### Scenario: No known birthplace
- **WHEN** a father has neither a birth nor a baptism Event with a Place or House
- **THEN** no generation line leads from him to his children

### Requirement: Where a Person was born
For Map lines, where a Person was born SHALL be the position of the birth Event in which they are the child, else of such a baptism Event: its House when the House has its own position, else its Place.

#### Scenario: Baptised in the parish church's village
- **WHEN** a child has no birth Event and was baptised in Vrbinov at čp. 3, which has its own position
- **THEN** the child's lines start or end at čp. 3 of Vrbinov

### Requirement: Map lines join Relatives only
A Map line SHALL be drawn only when every Person at its ends is a Relative: the parent and the child of a generation line, both partners of a marriage line. Possible relatives and Unrelated people SHALL NOT appear in Map lines, whatever the switch for Unrelated people says. The lines SHALL follow the relation to the family as the server last computed it, so they change when a Family root is marked or unmarked.

#### Scenario: A weak father link
- **WHEN** a child is a Relative and her father is a Possible relative
- **THEN** no generation line leads from the father to her

#### Scenario: Including Unrelated people
- **WHEN** a Member switches on Unrelated people on the map
- **THEN** pins change as before, and the Map lines stay the same

#### Scenario: A new Family root
- **WHEN** the Owner marks a Family root in another line of the family and a Member reopens the map
- **THEN** the lines of that line's Relatives appear

### Requirement: Switching Map lines
Map lines SHALL be shown with the family layer, with a switch in the year control to hide them, on by default and remembered on the device.

#### Scenario: Hiding the lines
- **WHEN** a Member switches Map lines off and reopens the app the next day
- **THEN** the map shows the family pins without lines, and the play control still moves the range

### Requirement: Map lines follow the year range
The family map SHALL show a Map line when at least one of its births or marriages falls in the year range, dated by the earliest year its Event could be. An Event whose date has an open start, or no date, SHALL give no line.

#### Scenario: One generation
- **WHEN** a Member sets the range to 1820–1850
- **THEN** only lines with a birth or marriage dated 1820 to 1850 remain

#### Scenario: Uncertain date
- **WHEN** a marriage is dated "1801/1803"
- **THEN** its line counts as 1801

### Requirement: Line width shows how many
The width of a Map line SHALL grow with the number of births or marriages on it within the year range, in four steps: 1, 2 to 3, 4 to 7, and 8 or more. The same number SHALL always give the same width.

#### Scenario: A busy road between two villages
- **WHEN** five children of Relatives born in Vrbinov were born in Habrová Lhota within the range
- **THEN** the line between the two villages has the third width

### Requirement: Line colour shows kind and age
A Map line SHALL be coloured by its kind, generation or marriage, and drawn fainter the longer ago its newest birth or marriage was before the end of the range: within 10 years, within 30 years, or earlier. Kind SHALL also show in the line's pattern, so that colour is never the only cue, and both colours SHALL stay distinguishable to readers with red-green colour blindness and over every base and historical map.

#### Scenario: A fading marriage line
- **WHEN** a marriage line's newest marriage was 25 years before the end of the range
- **THEN** it is drawn dashed in the marriage colour, at the middle strength

### Requirement: Legend of Map lines
While Map lines are shown, the map SHALL offer a legend that explains the two kinds, the four widths and the three strengths, in the Member's Interface language, and that can be folded away.

#### Scenario: Reading the legend on a phone
- **WHEN** a Member opens the legend at 390 px wide
- **THEN** it explains every kind, width and strength without covering the year control, and folds back with one tap

### Requirement: Playing through time
The play control SHALL move the whole year range forward by a step the Member chooses (1, 5 or 10 years, 5 by default), keeping its width, until it ends at 1950: the last step is shortened to end there. From the full range it SHALL start at 1600–1629. Pause SHALL stop it where it is, and buttons SHALL step one step back or forward. This replaces the decade steps of "Year slider".

#### Scenario: Watching the family spread
- **WHEN** a Member presses play with the full range
- **THEN** the range moves 1600–1629, 1605–1634, 1610–1639 and on, and lines appear, widen, fade and go as it moves

#### Scenario: Pausing and stepping
- **WHEN** a Member pauses at 1820–1849 and presses step forward twice
- **THEN** the range shows 1830–1859 and stays there

#### Scenario: Reduced motion
- **WHEN** the phone asks for reduced motion
- **THEN** play still steps through the years, and lines change without transitions

### Requirement: Smooth on a phone
While playing, each step SHALL change the lines without a request to the server, and SHALL take no longer than 50 ms of main-thread work on a mid-range phone, for up to 500 lines shown.

#### Scenario: Playing on a slow phone
- **WHEN** a Member plays the whole range on a mid-range Android phone with the Tree's Relatives loaded
- **THEN** every step is drawn without waiting for the network and without a visible stall

### Requirement: Readable at every zoom
Map lines SHALL join the pin groups of the zoom shown: lines inside one group are not drawn, and lines between the same two groups are drawn as one, with the widest width and strongest colour among them. A frame SHALL show at most 500 lines, keeping the widest and then the newest, and SHALL say how many it left out.

#### Scenario: The whole country
- **WHEN** a Member views the whole Czech lands with lines between 40 villages of one district
- **THEN** the district's lines inside one group are hidden, and the lines between groups are drawn once each

#### Scenario: Too many lines
- **WHEN** a frame has 620 lines
- **THEN** the 500 widest and newest are drawn, and the map says that 120 are not shown

### Requirement: What a line stands for
Tapping a Map line SHALL list its births or marriages within the range, each with its year, the Persons and links to their person pages. The lines of the frame SHALL also be available as a list for screen readers and keyboards.

#### Scenario: Tapping a line
- **WHEN** a Member taps the line between Vrbinov and Habrová Lhota
- **THEN** a sheet lists "1834 Jan Novák, son of Karel Novák" and the other births on it, each linking to the person page

### Requirement: Houses on the family map
A House with its own position SHALL have its own pin, and its Events SHALL sit there. A Person's life path SHALL show consecutive Events at two Houses with their own positions as two points, so that a move within one village shows.

#### Scenario: Moving within a village
- **WHEN** a man was born at čp. 7 and died at čp. 12 of the same village, and both Houses have their own positions
- **THEN** his life path shows two points in the village, joined by a short line
