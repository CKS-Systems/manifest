# Manifest Client

This module implements the `Amm` trait defined [here](https://github.com/jup-ag/rust-amm-implementation).

There are 2 versions - one to swap against global and one that
will not. If global accounts are not needed, then the user 
should not need to acquire excess locks and can avoid locking
global ahead of time.
To enforce this, the quoted price for global is 
artificially penalized by 1 atom to always be worse than
the non-global quote when both are the same.

### Testing

```
cargo test -- --nocapture
```
