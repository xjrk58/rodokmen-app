# How to deploy to netcup and go live

The steps for going live are still in the deploy guide, [`deploy/README.md`](../../deploy/README.md), because open branches are changing it. They move into these docs once those branches land ([#88](https://github.com/xjrk58/rodokmen-app/issues/88)), and this page then holds them.

Until then, follow the deploy guide in this order:

1. [What runs where](../../deploy/README.md#what-runs-where): the services you are setting up.
2. [The Owner's to-do list for going live](../../deploy/README.md#the-owners-to-do-list-for-going-live): the domain, the VPS at netcup, DNS, the email service, the Backup provider, the `.env` files, the GitHub secrets, the first deploy and the Owner account, the nightly Backup timer, an outside monitor, and the checks to run once live.
3. [Deploys](../../deploy/README.md#deploys): what each merge to `main` does, and how to roll back.
4. [When an alert arrives](../../deploy/README.md#when-an-alert-arrives).

The variables of `.env` and `backup.env` are also listed in [Configuration](../reference/configuration.md). To bring the server back after a loss, see [Restore from a Backup](restore-from-a-backup.md).
