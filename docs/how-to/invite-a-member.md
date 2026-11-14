# How to invite a Member

This guide shows the Owner how to invite a relative by email, how to send the same invitation from their own WhatsApp too, how to correct a Member's address later, and what to do when something goes wrong. Only the Owner can invite and correct addresses. Why the link is shown only once, and why the app never opens WhatsApp's web address, is in [Privacy and the public/private split](../explanation/privacy.md#invitation-links-in-chats).

## Invite by email

1. Open **Settings**. Under **Family members**, then **Invite a relative**, enter the relative's email address.
2. Pick the **Language of the invitation**: the language of the email, the WhatsApp message and the relative's first screens.
3. Click **Send the invitation**.

The email goes out at once, and the invitation is listed as **pending**. The link in it works once, for 7 days. Once the relative accepts, the invitation shows **accepted** and the relative is listed under **Members** as a Contributor.

The address you enter becomes the relative's account address, where Rodokmen sends their sign-in links. Check it before you send.

## Also send it through WhatsApp

Right after you send the invitation, Settings shows the message, ready in the invitation's language, under **Also send it through WhatsApp**. The message holds the same link as the email.

On a phone:

1. Tap **Send through WhatsApp**.
2. Your phone asks which app to use. Choose WhatsApp, then the relative, and send.

On a computer, or where there is no **Send through WhatsApp** button:

1. Click **Copy the message**.
2. Paste it into a chat with the relative in WhatsApp on the computer (the desktop app or WhatsApp Web), or send it to yourself and forward it from your phone.

If copying does not work, the message is selected: copy it with the keyboard (Ctrl+C, or ⌘C on a Mac).

When you are done, click **Done**. The message and its link are then gone from the screen.

## If you closed the message before sending it

The link is shown only once. The relative still has it in the email. To send it through WhatsApp after all:

1. Under **Family members**, find the invitation in the list and click **Withdraw**. The emailed link stops working.
2. Invite the same address again, and send the new message.

The relative gets a new email too. Tell them to use the newest link.

## If the address was wrong

The invitation page shows the relative the address the invitation went to, and asks them not to accept if it is not theirs. If they tell you it is wrong:

1. Click **Withdraw** next to the invitation.
2. Invite the right address.

If the right relative has already accepted an invitation sent to a wrong address, keep their account and [correct the address](#correct-a-members-address).

If someone else has accepted it, click **Disable** next to them under **Members**. That ends their sessions at once. Then invite the right address. Do not correct the address in that case ([why](../explanation/privacy.md#a-members-address)).

## Correct a Member's address

Correct a Member's address when it is mistyped, or when the relative stops using it. The Member keeps their account, Proposals, passkeys and link to their Person.

1. Open **Settings**. Under **Members**, find the Member and click **Correct the address**.
2. Enter the new address and click **Send a confirmation link**.
3. Tell the relative to open the email that arrives at the new address and press **Confirm the address** on the page it opens.

Until the relative confirms, nothing changes. Sign-in links still go to the old address, and Settings shows the new one as **waiting for confirmation**. The link works once, for 7 days. Once it is confirmed:

- sign-in links go to the new address;
- sign-in links already sent to the old address stop working;
- the relative stays signed in, and their passkeys keep working;
- the old address gets a short email saying that Rodokmen no longer uses it.

To undo a typo before the relative confirms, click **Withdraw** next to the waiting address, or correct the address again: the newer link replaces the older one.

An address that another Member has is refused. So is an address with a pending invitation: withdraw the invitation first. You can correct your own address the same way, in your own row.

## Withdraw an invitation

Click **Withdraw** next to a pending invitation. Its link stops working at once, whether it went by email, through WhatsApp or both, and the invitation shows **withdrawn**.

The same can be done through the API, under `/api/invitations` ([API](../reference/api.md#invitations)).
