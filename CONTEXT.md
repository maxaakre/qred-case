# Card Overview

The business card a company holds with the lender, as seen by one signed-in user in the mobile app: the card, what they have spent, what is due and what they can do next.

## People and companies

**User**:
A person who signs in to the app.
_Avoid_: Customer, account

**Company**:
A business that holds a credit agreement and cards. A user can belong to several.
_Avoid_: Customer, organisation, account

**Member**:
A user's membership in one company, with a role.
_Avoid_: Employee (that is a role), user (a user can be many members)

**Role**:
What a member may see in a company: `OWNER`, `ADMIN` or `EMPLOYEE`. Only owners and admins see invoices.

## Card

**Card**:
A payment card issued to one company and held by one member of it.
_Avoid_: Account, credit line

**Card holder**:
The user a card is issued to. Only the card holder can activate it.
_Avoid_: Owner (that is a role)

**Card status**:
`INACTIVE` (issued, not yet activated), `ACTIVE`, `FROZEN` (temporarily stopped) or `CLOSED` (permanently ended).
_Avoid_: Blocked, disabled

**Activation**:
The one-time step where the card holder proves they have the physical card by entering its last 4 digits, moving it from `INACTIVE` to `ACTIVE`.

**Activation lock**:
The state after too many wrong activation attempts. Only support can lift it.

## Limits and spend

**Credit limit**:
The most the lender allows on a card.
_Avoid_: Limit (ambiguous)

**Spend limit**:
The amount the user chose to cap their own spending at, never above the credit limit. This is "your set limit" in the app.
_Avoid_: Budget, limit (ambiguous)

**Spend period**:
The calendar month, in Swedish time, that spend is measured over.

**Spent**:
Purchases minus refunds in the current spend period, counting pending and settled transactions.
_Avoid_: Balance, used

**Remaining spend**:
Spend limit minus spent, never below zero.
_Avoid_: Available balance, available credit

## Money movement

**Transaction**:
A single card event with a merchant. A **purchase** takes money out, a **refund** puts it back.
_Avoid_: Payment, charge

**Transaction status**:
`PENDING` (authorised, not final), `SETTLED` (final) or `DECLINED` (never happened, does not count).

**Invoice**:
The lender's request for the company to pay for card spending.
_Avoid_: Bill, statement

**Invoice due**:
The oldest unpaid invoice of the company. It is **overdue** once its due date has passed.
