-- Rule proposals came from a model or the user agreeing with a label, and proposed a rule that did what the label already does. They now come only from the user giving a label's mail another action, which they carry.
DELETE FROM "proposals" WHERE "kind" = 'rule';
