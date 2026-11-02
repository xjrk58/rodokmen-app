# Run Rodokmen and make your first Proposal

In this tutorial, we will run Rodokmen on your computer with an invented Tree, sign in as its Owner with a passkey, and add a nickname to one of the invented Persons: first as a Proposal, then by accepting it in review. It takes about 20 minutes.

Everything in the fixture Tree is made up, so nothing you do here touches real family data.

## What you need

- Node.js 22 or newer, with pnpm 10 (`corepack enable` gives you the version the repo asks for).
- Docker, for the database.
- Chrome, or another browser that can save passkeys.
- Two terminals, both in a checkout of the repo:

  ```sh
  git clone https://github.com/xjrk58/rodokmen-app.git
  cd rodokmen-app
  ```

## 1. Install and start the database

First, install the workspace:

```sh
pnpm install
```

Now start PostgreSQL with PostGIS in Docker, and wait until it accepts connections:

```sh
docker run -d --name rodokmen-pg -p 5432:5432 -e POSTGRES_USER=rodokmen -e POSTGRES_PASSWORD=rodokmen -e POSTGRES_DB=rodokmen_dev postgis/postgis:16-3.4
until docker exec rodokmen-pg pg_isready -q -h 127.0.0.1 -U rodokmen; do sleep 1; done
```

The server's default database address is `postgres://rodokmen:rodokmen@localhost:5432/rodokmen_dev`, which is this container, so there is nothing to configure.

## 2. Load the invented Tree

```sh
pnpm --filter @rodokmen/server cli fixture load
```

The output ends with:

```text
loaded 206 invented Persons, 664 Events
```

Notice that you created no tables: the command applied the database migrations first.

## 3. Start the server

```sh
pnpm --filter @rodokmen/server dev
```

Leave it running. It serves the API and the app at http://localhost:3000. Open http://localhost:3000/api/health in the browser; it answers:

```json
{ "status": "ok", "database": "ok", "release": "dev" }
```

## 4. Create the Owner

In the second terminal, create the first account, the Owner:

```sh
pnpm --filter @rodokmen/server cli create-owner --email owner@example.org --name "Eva Example" --language en
```

There is no email service on your computer, so the email is printed instead. The output should look something like this:

```text
[outbox] to owner@example.org: Sign in to Rodokmen
Hello Eva Example,
…
http://localhost:3000/#link/k3ydubkJgwJ7-OzMNznIpxXzwhgJYGhHPh-Sc2njgKk
…
Owner owner@example.org created; a sign-in link was emailed. After signing in, register a passkey.
```

The link works once, within 15 minutes.

## 5. Sign in and save a passkey

Open the link in Chrome. The page is in Czech, because the app speaks Czech until it knows who you are. Click **Přihlásit se** (Sign in).

Now it knows you chose English for your account, and asks: "You are signed in. Save a passkey on this device?" Click **Save a passkey**, and let the browser save it.

The tree opens and asks "Where should the tree start?" with a list of people. Notice the tabs at the bottom: **Tree**, **Map**, **People**, **Review** and **Settings**.

Let's check that the passkey alone signs you in:

1. Open **Settings** and click **Sign out on this device**. The map opens.
2. Go to http://localhost:3000/#sign-in and click **Sign in with a passkey** (in Czech: **Přihlásit se přístupovým klíčem**). Choose the passkey you saved.

You are back in the tree, and no email was needed.

## 6. Find Jan Novák

Open **People** and type `Jan Novák`. Two Persons appear: Jan Novák 1801–1850 and Jan Novák 1899–1966. Click the first.

His page lists his Names (Jan Novák, the Latin form Joannes Nowak and the German form Johann Nowak), then his Events. Notice that each Event names the Source it was found in, and the confidence of that Citation.

## 7. Propose a nickname

Imagine a relative told you that everyone in the village called him Honza. That is one finding, so it becomes one Proposal.

1. Open **Review**, then the **Propose** tab at the top, and choose **A new Name**.
2. Under **Person**, type `Jan Novák` and pick **Jan Novák (\* 1801)**.
3. Fill in **Given names** `Honza`, **Surname** `Novák`, **spelling as found** `Honza`, and choose the kind **nickname**.
4. Under **Evidence**, choose **Family account** and fill in **Who told it** `Eva Example`, **When** `2026-11`, **Short title** `What grandmother told`, and **Transcription of the entry** `Everyone in the village called him Honza.` Leave **Confidence** at **normal**.
5. In **Note for the Editor**, write `Nickname from a Family account.`
6. Click **Submit for review**.

The app opens **My Proposals**. Your Proposal is there, **pending**, with its changes written out:

```text
adds the Name “Honza” (nickname) to Jan Novák
adds the Family account “What grandmother told”, given by Eva Example in 2026-11
adds a Citation of “What grandmother told” (normal confidence)
cites “What grandmother told” for “Honza”
```

Notice that one finding became four changes, submitted together.

Now open Jan Novák's page again from **People**. Honza is not there yet: a Proposal changes the Tree only when an Editor accepts it.

## 8. Accept it

The Owner is also an Editor, so you can review your own Proposal here.

1. Open **Review**, then the **Review** tab at the top. It says "1 waiting, oldest first" and shows your Proposal: its author, its changes and its evidence.
2. Click **Accept**.

The queue now says "Nothing is waiting for review."

Open Jan Novák's page once more. "Honza · nickname" is among his Names, with its Citation, "What grandmother told". Click **History**: the Proposal is there, by Eva Example and accepted by Eva Example, with a button to undo the whole Proposal.

## What you did

You ran the app and the API from the repo against a local database, loaded the invented Tree, signed in with a passkey, and took one finding through a Proposal and review into the Tree.

When you are done, stop the server with Ctrl+C and remove the database with `docker rm -f rodokmen-pg`.

## Where next

- Why every change goes through a Proposal: [Proposals and review](../explanation/proposals-and-review.md).
- Who counts as family: [mark a Family root](../how-to/mark-family-roots.md) and see the tree and People change.
- Let an AI assistant propose too: [connect an assistant through MCP](../how-to/connect-an-assistant.md).
- Change something yourself: [work on a change](../how-to/work-on-a-change.md).
