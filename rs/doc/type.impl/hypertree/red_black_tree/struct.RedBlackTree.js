(function() {var type_impls = {
"manifest":[["<details class=\"toggle implementors-toggle\" open><summary><section id=\"impl-IntoIterator-for-RedBlackTree%3C'a,+V%3E\" class=\"impl\"><a class=\"src rightside\" href=\"src/hypertree/red_black_tree.rs.html#1128\">source</a><a href=\"#impl-IntoIterator-for-RedBlackTree%3C'a,+V%3E\" class=\"anchor\">§</a><h3 class=\"code-header\">impl&lt;'a, V&gt; <a class=\"trait\" href=\"https://doc.rust-lang.org/1.78.0/core/iter/traits/collect/trait.IntoIterator.html\" title=\"trait core::iter::traits::collect::IntoIterator\">IntoIterator</a> for <a class=\"struct\" href=\"hypertree/red_black_tree/struct.RedBlackTree.html\" title=\"struct hypertree::red_black_tree::RedBlackTree\">RedBlackTree</a>&lt;'a, V&gt;<div class=\"where\">where\n    V: <a class=\"trait\" href=\"hypertree/red_black_tree/trait.TreeValue.html\" title=\"trait hypertree::red_black_tree::TreeValue\">TreeValue</a>,</div></h3></section></summary><div class=\"impl-items\"><details class=\"toggle\" open><summary><section id=\"associatedtype.Item\" class=\"associatedtype trait-impl\"><a href=\"#associatedtype.Item\" class=\"anchor\">§</a><h4 class=\"code-header\">type <a href=\"https://doc.rust-lang.org/1.78.0/core/iter/traits/collect/trait.IntoIterator.html#associatedtype.Item\" class=\"associatedtype\">Item</a> = (<a class=\"primitive\" href=\"https://doc.rust-lang.org/1.78.0/std/primitive.u32.html\">u32</a>, <a class=\"struct\" href=\"hypertree/red_black_tree/struct.RBNode.html\" title=\"struct hypertree::red_black_tree::RBNode\">RBNode</a>&lt;V&gt;)</h4></section></summary><div class='docblock'>The type of the elements being iterated over.</div></details><details class=\"toggle\" open><summary><section id=\"associatedtype.IntoIter\" class=\"associatedtype trait-impl\"><a href=\"#associatedtype.IntoIter\" class=\"anchor\">§</a><h4 class=\"code-header\">type <a href=\"https://doc.rust-lang.org/1.78.0/core/iter/traits/collect/trait.IntoIterator.html#associatedtype.IntoIter\" class=\"associatedtype\">IntoIter</a> = <a class=\"struct\" href=\"hypertree/red_black_tree/struct.RedBlackTreeIntoIterator.html\" title=\"struct hypertree::red_black_tree::RedBlackTreeIntoIterator\">RedBlackTreeIntoIterator</a>&lt;'a, V&gt;</h4></section></summary><div class='docblock'>Which kind of iterator are we turning this into?</div></details><details class=\"toggle method-toggle\" open><summary><section id=\"method.into_iter\" class=\"method trait-impl\"><a class=\"src rightside\" href=\"src/hypertree/red_black_tree.rs.html#1132\">source</a><a href=\"#method.into_iter\" class=\"anchor\">§</a><h4 class=\"code-header\">fn <a href=\"https://doc.rust-lang.org/1.78.0/core/iter/traits/collect/trait.IntoIterator.html#tymethod.into_iter\" class=\"fn\">into_iter</a>(self) -&gt; <a class=\"struct\" href=\"hypertree/red_black_tree/struct.RedBlackTreeIntoIterator.html\" title=\"struct hypertree::red_black_tree::RedBlackTreeIntoIterator\">RedBlackTreeIntoIterator</a>&lt;'a, V&gt;</h4></section></summary><div class='docblock'>Creates an iterator from a value. <a href=\"https://doc.rust-lang.org/1.78.0/core/iter/traits/collect/trait.IntoIterator.html#tymethod.into_iter\">Read more</a></div></details></div></details>","IntoIterator","manifest::state::global::GlobalTraderTree","manifest::state::market::ClaimedSeatTree","manifest::state::market::Bookside"],["<details class=\"toggle implementors-toggle\" open><summary><section id=\"impl-RedBlackTree%3C'a,+V%3E\" class=\"impl\"><a class=\"src rightside\" href=\"src/hypertree/red_black_tree.rs.html#374\">source</a><a href=\"#impl-RedBlackTree%3C'a,+V%3E\" class=\"anchor\">§</a><h3 class=\"code-header\">impl&lt;'a, V&gt; <a class=\"struct\" href=\"hypertree/red_black_tree/struct.RedBlackTree.html\" title=\"struct hypertree::red_black_tree::RedBlackTree\">RedBlackTree</a>&lt;'a, V&gt;<div class=\"where\">where\n    V: <a class=\"trait\" href=\"hypertree/red_black_tree/trait.TreeValue.html\" title=\"trait hypertree::red_black_tree::TreeValue\">TreeValue</a>,</div></h3></section></summary><div class=\"impl-items\"><details class=\"toggle method-toggle\" open><summary><section id=\"method.new\" class=\"method\"><a class=\"src rightside\" href=\"src/hypertree/red_black_tree.rs.html#377\">source</a><h4 class=\"code-header\">pub fn <a href=\"hypertree/red_black_tree/struct.RedBlackTree.html#tymethod.new\" class=\"fn\">new</a>(\n    data: &amp;'a mut [<a class=\"primitive\" href=\"https://doc.rust-lang.org/1.78.0/std/primitive.u8.html\">u8</a>],\n    root_index: <a class=\"primitive\" href=\"https://doc.rust-lang.org/1.78.0/std/primitive.u32.html\">u32</a>,\n    max_index: <a class=\"primitive\" href=\"https://doc.rust-lang.org/1.78.0/std/primitive.u32.html\">u32</a>\n) -&gt; <a class=\"struct\" href=\"hypertree/red_black_tree/struct.RedBlackTree.html\" title=\"struct hypertree::red_black_tree::RedBlackTree\">RedBlackTree</a>&lt;'a, V&gt;</h4></section></summary><div class=\"docblock\"><p>Creates a new RedBlackTree. Does not mutate data yet. Assumes the actual\ndata in data is already well formed as a red black tree.</p>\n</div></details><details class=\"toggle method-toggle\" open><summary><section id=\"method.insert\" class=\"method\"><a class=\"src rightside\" href=\"src/hypertree/red_black_tree.rs.html#387\">source</a><h4 class=\"code-header\">pub fn <a href=\"hypertree/red_black_tree/struct.RedBlackTree.html#tymethod.insert\" class=\"fn\">insert</a>(&amp;mut self, index: <a class=\"primitive\" href=\"https://doc.rust-lang.org/1.78.0/std/primitive.u32.html\">u32</a>, value: V)</h4></section></summary><div class=\"docblock\"><p>Insert and rebalance. The data at index should be already zeroed.</p>\n</div></details><details class=\"toggle method-toggle\" open><summary><section id=\"method.remove_by_index\" class=\"method\"><a class=\"src rightside\" href=\"src/hypertree/red_black_tree.rs.html#435\">source</a><h4 class=\"code-header\">pub fn <a href=\"hypertree/red_black_tree/struct.RedBlackTree.html#tymethod.remove_by_index\" class=\"fn\">remove_by_index</a>(&amp;mut self, index: <a class=\"primitive\" href=\"https://doc.rust-lang.org/1.78.0/std/primitive.u32.html\">u32</a>)</h4></section></summary><div class=\"docblock\"><p>Remove a node by index and rebalance.</p>\n</div></details><details class=\"toggle method-toggle\" open><summary><section id=\"method.iter\" class=\"method\"><a class=\"src rightside\" href=\"src/hypertree/red_black_tree.rs.html#977\">source</a><h4 class=\"code-header\">pub fn <a href=\"hypertree/red_black_tree/struct.RedBlackTree.html#tymethod.iter\" class=\"fn\">iter</a>(&amp;self) -&gt; <a class=\"struct\" href=\"hypertree/red_black_tree/struct.RedBlackTreeIterator.html\" title=\"struct hypertree::red_black_tree::RedBlackTreeIterator\">RedBlackTreeIterator</a>&lt;'_, V&gt;</h4></section></summary><div class=\"docblock\"><p>Sorted iterator starting from the min.</p>\n</div></details></div></details>",0,"manifest::state::global::GlobalTraderTree","manifest::state::market::ClaimedSeatTree","manifest::state::market::Bookside"]]
};if (window.register_type_impls) {window.register_type_impls(type_impls);} else {window.pending_type_impls = type_impls;}})()