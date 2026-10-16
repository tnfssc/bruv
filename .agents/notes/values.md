# Values

## bruv builds on Pi; it never forks it

Users run Pi as Pi ships it. bruv adds to the Pi that is running and leaves the install alone, so
a Pi update, a global install or plain `pi` are never affected.

When Pi lacks a hook, bruv may change the running Pi in memory, as `src/compact.ts` does. Such a
change is a guest: it does nothing while its feature is off, it leaves Pi as it found it when
turned off or at shutdown, and it steps aside on a Pi that lacks what it changes. A Pi update
should cost a feature, never a broken Pi. Keep such changes few, and ask Pi for a hook when one
would replace them.
