# Make a Chart

Rodokmen draws two kinds of Chart from the Tree: a Descendant chart and a House chart. Why they look and behave as they do is in [Charts](../explanation/charts.md); the routes are in [the API reference](../reference/api.md#charts).

## Open a Descendant chart

1. Open a person page and tap **Descendant chart** (Czech: **Rozrod**), or in the tree tap **▤** beside the zoom buttons for the Person in the middle.
2. The Chart shows that Person's descendants with their partners, 4 generations deep. Pan with a finger or the mouse, pinch or use the wheel to zoom, or use the arrow keys and `+` and `−` once you have clicked the Chart.
3. Tap a card to open that Person's page.

To start from a couple instead of one Person, change `person` to `family` in the address and put the Family's id after it: `#chart/descendants/family/<id>`.

## Choose the generations, the form and the Direct line

Open **Options** above the Chart.

- **Generations**: `−` and `+` show 2 to 8 generations. With more than 500 cards, the Chart keeps fewer whole generations and says how many descendants it left out.
- **Direct line to**: your own Person and the Person in the middle of the tree come first, then every descendant in the Chart. The line is marked in the tree form. If it goes deeper than the Chart, a note offers to show it.
- **Form**: **Direct line** draws the line down the centre, one couple per row, with their children listed under it and the married brothers and sisters beside it. It needs a Direct line first.

## Open a branch

A Person whose descendants the Chart leaves out has an arrow under their card. Tap the arrow, or press and hold the card, to open a Chart from that Person with the same options.

## Open a House chart

1. On a person page, find an Event at a House and tap **House chart** (Czech: **Dům v čase**) under it.
2. The House chart lists the Families who lived at the House, in time order, with their period, the house numbers of that period, their children, and how each Family is linked to an earlier one.
3. In **Options**, switch on **Show unrelated people too** to see lodgers and other Families with no link to the family.
4. With more than 80 Families, the Chart asks for a period: enter **From year** and **To year** and tap **Show**.

## Print a Sheet

1. In **Options**, choose the **Paper** (A3 landscape unless you change it) and how **Living people on the sheet** appear: with their name and year of birth, or without names.
2. Tap **Print**. Your browser's print dialog opens with the Sheet. On a phone, choose **Save as PDF** to keep it.

A Chart too large for one page at a readable size prints on several numbered pages; each branch moved to a later page leaves a card with that page's number.

## Download a Sheet

- **Download SVG** saves the whole Chart as one file with its fonts inside. It scales to any size and opens in a browser or a drawing program.
- **Download PNG** saves a picture. A large Chart is made smaller to fit your device; the app says so, and then SVG or printing gives a sharper result.

A Sheet, printed or downloaded, shows Living people reduced as in an Export. On screen they appear in full, marked as living.

## Keep a Chart for offline use

Open a Chart once while online. It stays on the device, with its Sheet, so you can open and print it later without a connection; the line under the title says when it was loaded. To share a Chart with another Member, send them its address.
