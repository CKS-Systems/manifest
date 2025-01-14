(function() {var type_impls = {
"manifest":[["<details class=\"toggle implementors-toggle\" open><summary><section id=\"impl-Clone-for-DynamicAccount%3CFixed,+Dynamic%3E\" class=\"impl\"><a class=\"src rightside\" href=\"src/manifest/state/dynamic_account.rs.html#1\">source</a><a href=\"#impl-Clone-for-DynamicAccount%3CFixed,+Dynamic%3E\" class=\"anchor\">§</a><h3 class=\"code-header\">impl&lt;Fixed: <a class=\"trait\" href=\"https://doc.rust-lang.org/1.78.0/core/clone/trait.Clone.html\" title=\"trait core::clone::Clone\">Clone</a>, Dynamic: <a class=\"trait\" href=\"https://doc.rust-lang.org/1.78.0/core/clone/trait.Clone.html\" title=\"trait core::clone::Clone\">Clone</a>&gt; <a class=\"trait\" href=\"https://doc.rust-lang.org/1.78.0/core/clone/trait.Clone.html\" title=\"trait core::clone::Clone\">Clone</a> for <a class=\"struct\" href=\"manifest/state/dynamic_account/struct.DynamicAccount.html\" title=\"struct manifest::state::dynamic_account::DynamicAccount\">DynamicAccount</a>&lt;Fixed, Dynamic&gt;</h3></section></summary><div class=\"impl-items\"><details class=\"toggle method-toggle\" open><summary><section id=\"method.clone\" class=\"method trait-impl\"><a class=\"src rightside\" href=\"src/manifest/state/dynamic_account.rs.html#1\">source</a><a href=\"#method.clone\" class=\"anchor\">§</a><h4 class=\"code-header\">fn <a href=\"https://doc.rust-lang.org/1.78.0/core/clone/trait.Clone.html#tymethod.clone\" class=\"fn\">clone</a>(&amp;self) -&gt; <a class=\"struct\" href=\"manifest/state/dynamic_account/struct.DynamicAccount.html\" title=\"struct manifest::state::dynamic_account::DynamicAccount\">DynamicAccount</a>&lt;Fixed, Dynamic&gt;</h4></section></summary><div class='docblock'>Returns a copy of the value. <a href=\"https://doc.rust-lang.org/1.78.0/core/clone/trait.Clone.html#tymethod.clone\">Read more</a></div></details><details class=\"toggle method-toggle\" open><summary><section id=\"method.clone_from\" class=\"method trait-impl\"><span class=\"rightside\"><span class=\"since\" title=\"Stable since Rust version 1.0.0\">1.0.0</span> · <a class=\"src\" href=\"https://doc.rust-lang.org/1.78.0/src/core/clone.rs.html#169\">source</a></span><a href=\"#method.clone_from\" class=\"anchor\">§</a><h4 class=\"code-header\">fn <a href=\"https://doc.rust-lang.org/1.78.0/core/clone/trait.Clone.html#method.clone_from\" class=\"fn\">clone_from</a>(&amp;mut self, source: <a class=\"primitive\" href=\"https://doc.rust-lang.org/1.78.0/std/primitive.reference.html\">&amp;Self</a>)</h4></section></summary><div class='docblock'>Performs copy-assignment from <code>source</code>. <a href=\"https://doc.rust-lang.org/1.78.0/core/clone/trait.Clone.html#method.clone_from\">Read more</a></div></details></div></details>","Clone","manifest::state::global::GlobalValue","manifest::state::global::GlobalRef","manifest::state::global::GlobalRefMut","manifest::state::market::MarketValue","manifest::state::market::MarketRef","manifest::state::market::MarketRefMut"],["<details class=\"toggle implementors-toggle\" open><summary><section id=\"impl-DynamicAccount%3CFixed,+Dynamic%3E\" class=\"impl\"><a class=\"src rightside\" href=\"src/manifest/state/global.rs.html#243-295\">source</a><a href=\"#impl-DynamicAccount%3CFixed,+Dynamic%3E\" class=\"anchor\">§</a><h3 class=\"code-header\">impl&lt;Fixed: <a class=\"trait\" href=\"manifest/state/dynamic_account/trait.DerefOrBorrow.html\" title=\"trait manifest::state::dynamic_account::DerefOrBorrow\">DerefOrBorrow</a>&lt;<a class=\"struct\" href=\"manifest/state/global/struct.GlobalFixed.html\" title=\"struct manifest::state::global::GlobalFixed\">GlobalFixed</a>&gt;, Dynamic: <a class=\"trait\" href=\"manifest/state/dynamic_account/trait.DerefOrBorrow.html\" title=\"trait manifest::state::dynamic_account::DerefOrBorrow\">DerefOrBorrow</a>&lt;[<a class=\"primitive\" href=\"https://doc.rust-lang.org/1.78.0/std/primitive.u8.html\">u8</a>]&gt;&gt; <a class=\"struct\" href=\"manifest/state/dynamic_account/struct.DynamicAccount.html\" title=\"struct manifest::state::dynamic_account::DynamicAccount\">DynamicAccount</a>&lt;Fixed, Dynamic&gt;</h3></section></summary><div class=\"impl-items\"><section id=\"method.get_balance_atoms\" class=\"method\"><a class=\"src rightside\" href=\"src/manifest/state/global.rs.html#253-262\">source</a><h4 class=\"code-header\">pub fn <a href=\"manifest/state/dynamic_account/struct.DynamicAccount.html#tymethod.get_balance_atoms\" class=\"fn\">get_balance_atoms</a>(&amp;self, trader: &amp;Pubkey) -&gt; <a class=\"struct\" href=\"manifest/quantities/struct.GlobalAtoms.html\" title=\"struct manifest::quantities::GlobalAtoms\">GlobalAtoms</a></h4></section><section id=\"method.verify_min_balance\" class=\"method\"><a class=\"src rightside\" href=\"src/manifest/state/global.rs.html#264-294\">source</a><h4 class=\"code-header\">pub fn <a href=\"manifest/state/dynamic_account/struct.DynamicAccount.html#tymethod.verify_min_balance\" class=\"fn\">verify_min_balance</a>(&amp;self, trader: &amp;Pubkey) -&gt; ProgramResult</h4></section></div></details>",0,"manifest::state::global::GlobalValue","manifest::state::global::GlobalRef","manifest::state::global::GlobalRefMut","manifest::state::market::MarketValue","manifest::state::market::MarketRef","manifest::state::market::MarketRefMut"],["<details class=\"toggle implementors-toggle\" open><summary><section id=\"impl-DynamicAccount%3CFixed,+Dynamic%3E\" class=\"impl\"><a class=\"src rightside\" href=\"src/manifest/state/global.rs.html#297-549\">source</a><a href=\"#impl-DynamicAccount%3CFixed,+Dynamic%3E\" class=\"anchor\">§</a><h3 class=\"code-header\">impl&lt;Fixed: <a class=\"trait\" href=\"manifest/state/dynamic_account/trait.DerefOrBorrowMut.html\" title=\"trait manifest::state::dynamic_account::DerefOrBorrowMut\">DerefOrBorrowMut</a>&lt;<a class=\"struct\" href=\"manifest/state/global/struct.GlobalFixed.html\" title=\"struct manifest::state::global::GlobalFixed\">GlobalFixed</a>&gt;, Dynamic: <a class=\"trait\" href=\"manifest/state/dynamic_account/trait.DerefOrBorrowMut.html\" title=\"trait manifest::state::dynamic_account::DerefOrBorrowMut\">DerefOrBorrowMut</a>&lt;[<a class=\"primitive\" href=\"https://doc.rust-lang.org/1.78.0/std/primitive.u8.html\">u8</a>]&gt;&gt; <a class=\"struct\" href=\"manifest/state/dynamic_account/struct.DynamicAccount.html\" title=\"struct manifest::state::dynamic_account::DynamicAccount\">DynamicAccount</a>&lt;Fixed, Dynamic&gt;</h3></section></summary><div class=\"impl-items\"><section id=\"method.global_expand\" class=\"method\"><a class=\"src rightside\" href=\"src/manifest/state/global.rs.html#307-325\">source</a><h4 class=\"code-header\">pub fn <a href=\"manifest/state/dynamic_account/struct.DynamicAccount.html#tymethod.global_expand\" class=\"fn\">global_expand</a>(&amp;mut self) -&gt; ProgramResult</h4></section><section id=\"method.reduce\" class=\"method\"><a class=\"src rightside\" href=\"src/manifest/state/global.rs.html#327-340\">source</a><h4 class=\"code-header\">pub fn <a href=\"manifest/state/dynamic_account/struct.DynamicAccount.html#tymethod.reduce\" class=\"fn\">reduce</a>(\n    &amp;mut self,\n    trader: &amp;Pubkey,\n    num_atoms: <a class=\"struct\" href=\"manifest/quantities/struct.GlobalAtoms.html\" title=\"struct manifest::quantities::GlobalAtoms\">GlobalAtoms</a>\n) -&gt; ProgramResult</h4></section><details class=\"toggle method-toggle\" open><summary><section id=\"method.add_trader\" class=\"method\"><a class=\"src rightside\" href=\"src/manifest/state/global.rs.html#343-379\">source</a><h4 class=\"code-header\">pub fn <a href=\"manifest/state/dynamic_account/struct.DynamicAccount.html#tymethod.add_trader\" class=\"fn\">add_trader</a>(&amp;mut self, trader: &amp;Pubkey) -&gt; ProgramResult</h4></section></summary><div class=\"docblock\"><p>Add GlobalTrader to the tree of global traders</p>\n</div></details><details class=\"toggle method-toggle\" open><summary><section id=\"method.evict_and_take_seat\" class=\"method\"><a class=\"src rightside\" href=\"src/manifest/state/global.rs.html#382-465\">source</a><h4 class=\"code-header\">pub fn <a href=\"manifest/state/dynamic_account/struct.DynamicAccount.html#tymethod.evict_and_take_seat\" class=\"fn\">evict_and_take_seat</a>(\n    &amp;mut self,\n    existing_trader: &amp;Pubkey,\n    new_trader: &amp;Pubkey\n) -&gt; ProgramResult</h4></section></summary><div class=\"docblock\"><p>Evict from the global account and steal their seat</p>\n</div></details><details class=\"toggle method-toggle\" open><summary><section id=\"method.add_order\" class=\"method\"><a class=\"src rightside\" href=\"src/manifest/state/global.rs.html#468-513\">source</a><h4 class=\"code-header\">pub fn <a href=\"manifest/state/dynamic_account/struct.DynamicAccount.html#tymethod.add_order\" class=\"fn\">add_order</a>(\n    &amp;mut self,\n    resting_order: &amp;<a class=\"struct\" href=\"manifest/state/resting_order/struct.RestingOrder.html\" title=\"struct manifest::state::resting_order::RestingOrder\">RestingOrder</a>,\n    global_trade_owner: &amp;Pubkey\n) -&gt; ProgramResult</h4></section></summary><div class=\"docblock\"><p>Add global order to the global account and specific market.</p>\n</div></details><details class=\"toggle method-toggle\" open><summary><section id=\"method.deposit_global\" class=\"method\"><a class=\"src rightside\" href=\"src/manifest/state/global.rs.html#516-530\">source</a><h4 class=\"code-header\">pub fn <a href=\"manifest/state/dynamic_account/struct.DynamicAccount.html#tymethod.deposit_global\" class=\"fn\">deposit_global</a>(\n    &amp;mut self,\n    trader: &amp;Pubkey,\n    num_atoms: <a class=\"struct\" href=\"manifest/quantities/struct.GlobalAtoms.html\" title=\"struct manifest::quantities::GlobalAtoms\">GlobalAtoms</a>\n) -&gt; ProgramResult</h4></section></summary><div class=\"docblock\"><p>Deposit to global account.</p>\n</div></details><details class=\"toggle method-toggle\" open><summary><section id=\"method.withdraw_global\" class=\"method\"><a class=\"src rightside\" href=\"src/manifest/state/global.rs.html#533-548\">source</a><h4 class=\"code-header\">pub fn <a href=\"manifest/state/dynamic_account/struct.DynamicAccount.html#tymethod.withdraw_global\" class=\"fn\">withdraw_global</a>(\n    &amp;mut self,\n    trader: &amp;Pubkey,\n    num_atoms: <a class=\"struct\" href=\"manifest/quantities/struct.GlobalAtoms.html\" title=\"struct manifest::quantities::GlobalAtoms\">GlobalAtoms</a>\n) -&gt; ProgramResult</h4></section></summary><div class=\"docblock\"><p>Withdraw from global account.</p>\n</div></details></div></details>",0,"manifest::state::global::GlobalValue","manifest::state::global::GlobalRef","manifest::state::global::GlobalRefMut","manifest::state::market::MarketValue","manifest::state::market::MarketRef","manifest::state::market::MarketRefMut"],["<details class=\"toggle implementors-toggle\" open><summary><section id=\"impl-DynamicAccount%3CFixed,+Dynamic%3E\" class=\"impl\"><a class=\"src rightside\" href=\"src/manifest/state/market.rs.html#432-769\">source</a><a href=\"#impl-DynamicAccount%3CFixed,+Dynamic%3E\" class=\"anchor\">§</a><h3 class=\"code-header\">impl&lt;Fixed: <a class=\"trait\" href=\"manifest/state/dynamic_account/trait.DerefOrBorrow.html\" title=\"trait manifest::state::dynamic_account::DerefOrBorrow\">DerefOrBorrow</a>&lt;<a class=\"struct\" href=\"manifest/state/market/struct.MarketFixed.html\" title=\"struct manifest::state::market::MarketFixed\">MarketFixed</a>&gt;, Dynamic: <a class=\"trait\" href=\"manifest/state/dynamic_account/trait.DerefOrBorrow.html\" title=\"trait manifest::state::dynamic_account::DerefOrBorrow\">DerefOrBorrow</a>&lt;[<a class=\"primitive\" href=\"https://doc.rust-lang.org/1.78.0/std/primitive.u8.html\">u8</a>]&gt;&gt; <a class=\"struct\" href=\"manifest/state/dynamic_account/struct.DynamicAccount.html\" title=\"struct manifest::state::dynamic_account::DynamicAccount\">DynamicAccount</a>&lt;Fixed, Dynamic&gt;</h3></section></summary><div class=\"impl-items\"><section id=\"method.get_base_mint\" class=\"method\"><a class=\"src rightside\" href=\"src/manifest/state/market.rs.html#442-445\">source</a><h4 class=\"code-header\">pub fn <a href=\"manifest/state/dynamic_account/struct.DynamicAccount.html#tymethod.get_base_mint\" class=\"fn\">get_base_mint</a>(&amp;self) -&gt; &amp;Pubkey</h4></section><section id=\"method.get_quote_mint\" class=\"method\"><a class=\"src rightside\" href=\"src/manifest/state/market.rs.html#447-450\">source</a><h4 class=\"code-header\">pub fn <a href=\"manifest/state/dynamic_account/struct.DynamicAccount.html#tymethod.get_quote_mint\" class=\"fn\">get_quote_mint</a>(&amp;self) -&gt; &amp;Pubkey</h4></section><section id=\"method.has_free_block\" class=\"method\"><a class=\"src rightside\" href=\"src/manifest/state/market.rs.html#452-456\">source</a><h4 class=\"code-header\">pub fn <a href=\"manifest/state/dynamic_account/struct.DynamicAccount.html#tymethod.has_free_block\" class=\"fn\">has_free_block</a>(&amp;self) -&gt; <a class=\"primitive\" href=\"https://doc.rust-lang.org/1.78.0/std/primitive.bool.html\">bool</a></h4></section><section id=\"method.has_two_free_blocks\" class=\"method\"><a class=\"src rightside\" href=\"src/manifest/state/market.rs.html#458-467\">source</a><h4 class=\"code-header\">pub fn <a href=\"manifest/state/dynamic_account/struct.DynamicAccount.html#tymethod.has_two_free_blocks\" class=\"fn\">has_two_free_blocks</a>(&amp;self) -&gt; <a class=\"primitive\" href=\"https://doc.rust-lang.org/1.78.0/std/primitive.bool.html\">bool</a></h4></section><section id=\"method.impact_quote_atoms\" class=\"method\"><a class=\"src rightside\" href=\"src/manifest/state/market.rs.html#469-538\">source</a><h4 class=\"code-header\">pub fn <a href=\"manifest/state/dynamic_account/struct.DynamicAccount.html#tymethod.impact_quote_atoms\" class=\"fn\">impact_quote_atoms</a>(\n    &amp;self,\n    is_bid: <a class=\"primitive\" href=\"https://doc.rust-lang.org/1.78.0/std/primitive.bool.html\">bool</a>,\n    limit_base_atoms: <a class=\"struct\" href=\"manifest/quantities/struct.BaseAtoms.html\" title=\"struct manifest::quantities::BaseAtoms\">BaseAtoms</a>,\n    global_trade_accounts_opts: &amp;[<a class=\"enum\" href=\"https://doc.rust-lang.org/1.78.0/core/option/enum.Option.html\" title=\"enum core::option::Option\">Option</a>&lt;<a class=\"struct\" href=\"manifest/validation/loaders/struct.GlobalTradeAccounts.html\" title=\"struct manifest::validation::loaders::GlobalTradeAccounts\">GlobalTradeAccounts</a>&lt;'_, '_&gt;&gt;; <a class=\"primitive\" href=\"https://doc.rust-lang.org/1.78.0/std/primitive.array.html\">2</a>]\n) -&gt; <a class=\"enum\" href=\"https://doc.rust-lang.org/1.78.0/core/result/enum.Result.html\" title=\"enum core::result::Result\">Result</a>&lt;<a class=\"struct\" href=\"manifest/quantities/struct.QuoteAtoms.html\" title=\"struct manifest::quantities::QuoteAtoms\">QuoteAtoms</a>, ProgramError&gt;</h4></section><details class=\"toggle method-toggle\" open><summary><section id=\"method.impact_base_atoms\" class=\"method\"><a class=\"src rightside\" href=\"src/manifest/state/market.rs.html#555-637\">source</a><h4 class=\"code-header\">pub fn <a href=\"manifest/state/dynamic_account/struct.DynamicAccount.html#tymethod.impact_base_atoms\" class=\"fn\">impact_base_atoms</a>(\n    &amp;self,\n    is_bid: <a class=\"primitive\" href=\"https://doc.rust-lang.org/1.78.0/std/primitive.bool.html\">bool</a>,\n    limit_quote_atoms: <a class=\"struct\" href=\"manifest/quantities/struct.QuoteAtoms.html\" title=\"struct manifest::quantities::QuoteAtoms\">QuoteAtoms</a>,\n    global_trade_accounts_opts: &amp;[<a class=\"enum\" href=\"https://doc.rust-lang.org/1.78.0/core/option/enum.Option.html\" title=\"enum core::option::Option\">Option</a>&lt;<a class=\"struct\" href=\"manifest/validation/loaders/struct.GlobalTradeAccounts.html\" title=\"struct manifest::validation::loaders::GlobalTradeAccounts\">GlobalTradeAccounts</a>&lt;'_, '_&gt;&gt;; <a class=\"primitive\" href=\"https://doc.rust-lang.org/1.78.0/std/primitive.array.html\">2</a>]\n) -&gt; <a class=\"enum\" href=\"https://doc.rust-lang.org/1.78.0/core/result/enum.Result.html\" title=\"enum core::result::Result\">Result</a>&lt;<a class=\"struct\" href=\"manifest/quantities/struct.BaseAtoms.html\" title=\"struct manifest::quantities::BaseAtoms\">BaseAtoms</a>, ProgramError&gt;</h4></section></summary><div class=\"docblock\"><p>How many base atoms you get when you trade in limit_quote_atoms.</p>\n</div></details><section id=\"method.get_order_by_index\" class=\"method\"><a class=\"src rightside\" href=\"src/manifest/state/market.rs.html#640-643\">source</a><h4 class=\"code-header\">pub fn <a href=\"manifest/state/dynamic_account/struct.DynamicAccount.html#tymethod.get_order_by_index\" class=\"fn\">get_order_by_index</a>(&amp;self, index: <a class=\"type\" href=\"hypertree/utils/type.DataIndex.html\" title=\"type hypertree::utils::DataIndex\">DataIndex</a>) -&gt; &amp;<a class=\"struct\" href=\"manifest/state/resting_order/struct.RestingOrder.html\" title=\"struct manifest::state::resting_order::RestingOrder\">RestingOrder</a></h4></section><section id=\"method.get_trader_balance\" class=\"method\"><a class=\"src rightside\" href=\"src/manifest/state/market.rs.html#651-663\">source</a><h4 class=\"code-header\">pub fn <a href=\"manifest/state/dynamic_account/struct.DynamicAccount.html#tymethod.get_trader_balance\" class=\"fn\">get_trader_balance</a>(&amp;self, trader: &amp;Pubkey) -&gt; (<a class=\"struct\" href=\"manifest/quantities/struct.BaseAtoms.html\" title=\"struct manifest::quantities::BaseAtoms\">BaseAtoms</a>, <a class=\"struct\" href=\"manifest/quantities/struct.QuoteAtoms.html\" title=\"struct manifest::quantities::QuoteAtoms\">QuoteAtoms</a>)</h4></section><section id=\"method.get_trader_key_by_index\" class=\"method\"><a class=\"src rightside\" href=\"src/manifest/state/market.rs.html#665-669\">source</a><h4 class=\"code-header\">pub fn <a href=\"manifest/state/dynamic_account/struct.DynamicAccount.html#tymethod.get_trader_key_by_index\" class=\"fn\">get_trader_key_by_index</a>(&amp;self, index: <a class=\"type\" href=\"hypertree/utils/type.DataIndex.html\" title=\"type hypertree::utils::DataIndex\">DataIndex</a>) -&gt; &amp;Pubkey</h4></section><section id=\"method.get_trader_voume\" class=\"method\"><a class=\"src rightside\" href=\"src/manifest/state/market.rs.html#671-681\">source</a><h4 class=\"code-header\">pub fn <a href=\"manifest/state/dynamic_account/struct.DynamicAccount.html#tymethod.get_trader_voume\" class=\"fn\">get_trader_voume</a>(&amp;self, trader: &amp;Pubkey) -&gt; <a class=\"struct\" href=\"manifest/quantities/struct.QuoteAtoms.html\" title=\"struct manifest::quantities::QuoteAtoms\">QuoteAtoms</a></h4></section><section id=\"method.get_bids\" class=\"method\"><a class=\"src rightside\" href=\"src/manifest/state/market.rs.html#683-690\">source</a><h4 class=\"code-header\">pub fn <a href=\"manifest/state/dynamic_account/struct.DynamicAccount.html#tymethod.get_bids\" class=\"fn\">get_bids</a>(&amp;self) -&gt; <a class=\"type\" href=\"manifest/state/market/type.BooksideReadOnly.html\" title=\"type manifest::state::market::BooksideReadOnly\">BooksideReadOnly</a>&lt;'_&gt;</h4></section><section id=\"method.get_asks\" class=\"method\"><a class=\"src rightside\" href=\"src/manifest/state/market.rs.html#692-699\">source</a><h4 class=\"code-header\">pub fn <a href=\"manifest/state/dynamic_account/struct.DynamicAccount.html#tymethod.get_asks\" class=\"fn\">get_asks</a>(&amp;self) -&gt; <a class=\"type\" href=\"manifest/state/market/type.BooksideReadOnly.html\" title=\"type manifest::state::market::BooksideReadOnly\">BooksideReadOnly</a>&lt;'_&gt;</h4></section><section id=\"method.get_trader_index\" class=\"method\"><a class=\"src rightside\" href=\"src/manifest/state/market.rs.html#760-768\">source</a><h4 class=\"code-header\">pub fn <a href=\"manifest/state/dynamic_account/struct.DynamicAccount.html#tymethod.get_trader_index\" class=\"fn\">get_trader_index</a>(&amp;self, trader: &amp;Pubkey) -&gt; <a class=\"type\" href=\"hypertree/utils/type.DataIndex.html\" title=\"type hypertree::utils::DataIndex\">DataIndex</a></h4></section></div></details>",0,"manifest::state::global::GlobalValue","manifest::state::global::GlobalRef","manifest::state::global::GlobalRefMut","manifest::state::market::MarketValue","manifest::state::market::MarketRef","manifest::state::market::MarketRefMut"],["<details class=\"toggle implementors-toggle\" open><summary><section id=\"impl-DynamicAccount%3CFixed,+Dynamic%3E\" class=\"impl\"><a class=\"src rightside\" href=\"src/manifest/state/market.rs.html#773-1544\">source</a><a href=\"#impl-DynamicAccount%3CFixed,+Dynamic%3E\" class=\"anchor\">§</a><h3 class=\"code-header\">impl&lt;Fixed: <a class=\"trait\" href=\"manifest/state/dynamic_account/trait.DerefOrBorrowMut.html\" title=\"trait manifest::state::dynamic_account::DerefOrBorrowMut\">DerefOrBorrowMut</a>&lt;<a class=\"struct\" href=\"manifest/state/market/struct.MarketFixed.html\" title=\"struct manifest::state::market::MarketFixed\">MarketFixed</a>&gt; + <a class=\"trait\" href=\"manifest/state/dynamic_account/trait.DerefOrBorrow.html\" title=\"trait manifest::state::dynamic_account::DerefOrBorrow\">DerefOrBorrow</a>&lt;<a class=\"struct\" href=\"manifest/state/market/struct.MarketFixed.html\" title=\"struct manifest::state::market::MarketFixed\">MarketFixed</a>&gt;, Dynamic: <a class=\"trait\" href=\"manifest/state/dynamic_account/trait.DerefOrBorrowMut.html\" title=\"trait manifest::state::dynamic_account::DerefOrBorrowMut\">DerefOrBorrowMut</a>&lt;[<a class=\"primitive\" href=\"https://doc.rust-lang.org/1.78.0/std/primitive.u8.html\">u8</a>]&gt; + <a class=\"trait\" href=\"manifest/state/dynamic_account/trait.DerefOrBorrow.html\" title=\"trait manifest::state::dynamic_account::DerefOrBorrow\">DerefOrBorrow</a>&lt;[<a class=\"primitive\" href=\"https://doc.rust-lang.org/1.78.0/std/primitive.u8.html\">u8</a>]&gt;&gt; <a class=\"struct\" href=\"manifest/state/dynamic_account/struct.DynamicAccount.html\" title=\"struct manifest::state::dynamic_account::DynamicAccount\">DynamicAccount</a>&lt;Fixed, Dynamic&gt;</h3></section></summary><div class=\"impl-items\"><section id=\"method.market_expand\" class=\"method\"><a class=\"src rightside\" href=\"src/manifest/state/market.rs.html#785-794\">source</a><h4 class=\"code-header\">pub fn <a href=\"manifest/state/dynamic_account/struct.DynamicAccount.html#tymethod.market_expand\" class=\"fn\">market_expand</a>(&amp;mut self) -&gt; ProgramResult</h4></section><section id=\"method.claim_seat\" class=\"method\"><a class=\"src rightside\" href=\"src/manifest/state/market.rs.html#796-822\">source</a><h4 class=\"code-header\">pub fn <a href=\"manifest/state/dynamic_account/struct.DynamicAccount.html#tymethod.claim_seat\" class=\"fn\">claim_seat</a>(&amp;mut self, trader: &amp;Pubkey) -&gt; ProgramResult</h4></section><section id=\"method.release_seat\" class=\"method\"><a class=\"src rightside\" href=\"src/manifest/state/market.rs.html#827-839\">source</a><h4 class=\"code-header\">pub fn <a href=\"manifest/state/dynamic_account/struct.DynamicAccount.html#tymethod.release_seat\" class=\"fn\">release_seat</a>(&amp;mut self, trader: &amp;Pubkey) -&gt; ProgramResult</h4></section><section id=\"method.deposit\" class=\"method\"><a class=\"src rightside\" href=\"src/manifest/state/market.rs.html#841-855\">source</a><h4 class=\"code-header\">pub fn <a href=\"manifest/state/dynamic_account/struct.DynamicAccount.html#tymethod.deposit\" class=\"fn\">deposit</a>(\n    &amp;mut self,\n    trader_index: <a class=\"type\" href=\"hypertree/utils/type.DataIndex.html\" title=\"type hypertree::utils::DataIndex\">DataIndex</a>,\n    amount_atoms: <a class=\"primitive\" href=\"https://doc.rust-lang.org/1.78.0/std/primitive.u64.html\">u64</a>,\n    is_base: <a class=\"primitive\" href=\"https://doc.rust-lang.org/1.78.0/std/primitive.bool.html\">bool</a>\n) -&gt; ProgramResult</h4></section><section id=\"method.withdraw\" class=\"method\"><a class=\"src rightside\" href=\"src/manifest/state/market.rs.html#857-866\">source</a><h4 class=\"code-header\">pub fn <a href=\"manifest/state/dynamic_account/struct.DynamicAccount.html#tymethod.withdraw\" class=\"fn\">withdraw</a>(\n    &amp;mut self,\n    trader_index: <a class=\"type\" href=\"hypertree/utils/type.DataIndex.html\" title=\"type hypertree::utils::DataIndex\">DataIndex</a>,\n    amount_atoms: <a class=\"primitive\" href=\"https://doc.rust-lang.org/1.78.0/std/primitive.u64.html\">u64</a>,\n    is_base: <a class=\"primitive\" href=\"https://doc.rust-lang.org/1.78.0/std/primitive.bool.html\">bool</a>\n) -&gt; ProgramResult</h4></section><section id=\"method.place_order_\" class=\"method\"><a class=\"src rightside\" href=\"src/manifest/state/market.rs.html#868-873\">source</a><h4 class=\"code-header\">pub fn <a href=\"manifest/state/dynamic_account/struct.DynamicAccount.html#tymethod.place_order_\" class=\"fn\">place_order_</a>(\n    &amp;mut self,\n    args: <a class=\"struct\" href=\"manifest/state/market/struct.AddOrderToMarketArgs.html\" title=\"struct manifest::state::market::AddOrderToMarketArgs\">AddOrderToMarketArgs</a>&lt;'_, '_&gt;\n) -&gt; <a class=\"enum\" href=\"https://doc.rust-lang.org/1.78.0/core/result/enum.Result.html\" title=\"enum core::result::Result\">Result</a>&lt;<a class=\"struct\" href=\"manifest/state/market/struct.AddOrderToMarketResult.html\" title=\"struct manifest::state::market::AddOrderToMarketResult\">AddOrderToMarketResult</a>, ProgramError&gt;</h4></section><details class=\"toggle method-toggle\" open><summary><section id=\"method.place_order\" class=\"method\"><a class=\"src rightside\" href=\"src/manifest/state/market.rs.html#879-1319\">source</a><h4 class=\"code-header\">pub fn <a href=\"manifest/state/dynamic_account/struct.DynamicAccount.html#tymethod.place_order\" class=\"fn\">place_order</a>(\n    &amp;mut self,\n    args: <a class=\"struct\" href=\"manifest/state/market/struct.AddOrderToMarketArgs.html\" title=\"struct manifest::state::market::AddOrderToMarketArgs\">AddOrderToMarketArgs</a>&lt;'_, '_&gt;\n) -&gt; <a class=\"enum\" href=\"https://doc.rust-lang.org/1.78.0/core/result/enum.Result.html\" title=\"enum core::result::Result\">Result</a>&lt;<a class=\"struct\" href=\"manifest/state/market/struct.AddOrderToMarketResult.html\" title=\"struct manifest::state::market::AddOrderToMarketResult\">AddOrderToMarketResult</a>, ProgramError&gt;</h4></section></summary><div class=\"docblock\"><p>Place an order and update the market</p>\n<ol>\n<li>Check the order against the opposite bookside</li>\n<li>Rest any amount of the order leftover on the book</li>\n</ol>\n</div></details><section id=\"method.cancel_order\" class=\"method\"><a class=\"src rightside\" href=\"src/manifest/state/market.rs.html#1431-1487\">source</a><h4 class=\"code-header\">pub fn <a href=\"manifest/state/dynamic_account/struct.DynamicAccount.html#tymethod.cancel_order\" class=\"fn\">cancel_order</a>(\n    &amp;mut self,\n    trader_index: <a class=\"type\" href=\"hypertree/utils/type.DataIndex.html\" title=\"type hypertree::utils::DataIndex\">DataIndex</a>,\n    order_sequence_number: <a class=\"primitive\" href=\"https://doc.rust-lang.org/1.78.0/std/primitive.u64.html\">u64</a>,\n    global_trade_accounts_opts: &amp;[<a class=\"enum\" href=\"https://doc.rust-lang.org/1.78.0/core/option/enum.Option.html\" title=\"enum core::option::Option\">Option</a>&lt;<a class=\"struct\" href=\"manifest/validation/loaders/struct.GlobalTradeAccounts.html\" title=\"struct manifest::validation::loaders::GlobalTradeAccounts\">GlobalTradeAccounts</a>&lt;'_, '_&gt;&gt;; <a class=\"primitive\" href=\"https://doc.rust-lang.org/1.78.0/std/primitive.array.html\">2</a>]\n) -&gt; ProgramResult</h4></section><section id=\"method.cancel_order_by_index\" class=\"method\"><a class=\"src rightside\" href=\"src/manifest/state/market.rs.html#1490-1543\">source</a><h4 class=\"code-header\">pub fn <a href=\"manifest/state/dynamic_account/struct.DynamicAccount.html#tymethod.cancel_order_by_index\" class=\"fn\">cancel_order_by_index</a>(\n    &amp;mut self,\n    order_index: <a class=\"type\" href=\"hypertree/utils/type.DataIndex.html\" title=\"type hypertree::utils::DataIndex\">DataIndex</a>,\n    global_trade_accounts_opts: &amp;[<a class=\"enum\" href=\"https://doc.rust-lang.org/1.78.0/core/option/enum.Option.html\" title=\"enum core::option::Option\">Option</a>&lt;<a class=\"struct\" href=\"manifest/validation/loaders/struct.GlobalTradeAccounts.html\" title=\"struct manifest::validation::loaders::GlobalTradeAccounts\">GlobalTradeAccounts</a>&lt;'_, '_&gt;&gt;; <a class=\"primitive\" href=\"https://doc.rust-lang.org/1.78.0/std/primitive.array.html\">2</a>]\n) -&gt; ProgramResult</h4></section></div></details>",0,"manifest::state::global::GlobalValue","manifest::state::global::GlobalRef","manifest::state::global::GlobalRefMut","manifest::state::market::MarketValue","manifest::state::market::MarketRef","manifest::state::market::MarketRefMut"]]
};if (window.register_type_impls) {window.register_type_impls(type_impls);} else {window.pending_type_impls = type_impls;}})()