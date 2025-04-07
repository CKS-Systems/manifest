# Manifest Client

This module implements the `Amm` trait defined [here](https://github.com/jup-ag/rust-amm-implementation).

There are 2 versions - one to swap against global and one that
will not. If global accounts are not needed, then the user 
should not need to acquire excess locks and can avoid locking
global ahead of time.
To enforce this, the quoted price for global is 
artificially penalized by 1 atom to always be worse than
the non-global quote when both are the same.

The recommendation is to only use the global version if you only are going to do
one. When lock contention becomes a concern for the global accounts, it will
become worthwhile to also utilize the local one which will have less trouble
landing tx, but might not see the global orders.

### Testing

```
cargo test -- --nocapture
```
