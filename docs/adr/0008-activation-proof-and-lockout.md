# Activation requires the card's last 4 digits and locks after 5 wrong attempts

To activate, the card holder enters the last 4 digits printed on the physical card. Because that proof would be pointless if the app showed the digits, `last4` is `null` in the API while the card is `INACTIVE`.

Four digits can be guessed, so after 5 wrong attempts activation is locked (`423`) until support unlocks it. The attempt counter is incremented with a single atomic `UPDATE ... RETURNING`, so concurrent requests cannot each read "4 attempts" and get an extra guess.

Activating a replacement card closes the holder's older `ACTIVE` or `FROZEN` card in the same company, in the same statement. One card works at a time, so the overview never shows the new card's empty spend while the old card can still be used. The old card's transactions stay readable.

## Considered Options

- **Activation code sent with the card, stored hashed**: stronger and more realistic, but needs card issuing and letters, which is out of scope here.
- **Just a button**: anyone with the session could activate a card they never received.
- **Automatic unlock after 24 hours**: less support load, but lets an attacker keep guessing slowly.
