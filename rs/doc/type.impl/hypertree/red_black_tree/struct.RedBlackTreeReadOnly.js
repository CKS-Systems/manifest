(function() {var type_impls = {
"manifest":[["<details class=\"toggle implementors-toggle\" open><summary><section id=\"impl-RedBlackTreeReadOnly%3C'a,+V%3E\" class=\"impl\"><a class=\"src rightside\" href=\"src/hypertree/red_black_tree.rs.html#45\">source</a><a href=\"#impl-RedBlackTreeReadOnly%3C'a,+V%3E\" class=\"anchor\">§</a><h3 class=\"code-header\">impl&lt;'a, V&gt; <a class=\"struct\" href=\"hypertree/red_black_tree/struct.RedBlackTreeReadOnly.html\" title=\"struct hypertree::red_black_tree::RedBlackTreeReadOnly\">RedBlackTreeReadOnly</a>&lt;'a, V&gt;<div class=\"where\">where\n    V: <a class=\"trait\" href=\"hypertree/red_black_tree/trait.TreeValue.html\" title=\"trait hypertree::red_black_tree::TreeValue\">TreeValue</a>,</div></h3></section></summary><div class=\"impl-items\"><details class=\"toggle method-toggle\" open><summary><section id=\"method.new\" class=\"method\"><a class=\"src rightside\" href=\"src/hypertree/red_black_tree.rs.html#48\">source</a><h4 class=\"code-header\">pub fn <a href=\"hypertree/red_black_tree/struct.RedBlackTreeReadOnly.html#tymethod.new\" class=\"fn\">new</a>(\n    data: &amp;'a [<a class=\"primitive\" href=\"https://doc.rust-lang.org/1.78.0/std/primitive.u8.html\">u8</a>],\n    root_index: <a class=\"primitive\" href=\"https://doc.rust-lang.org/1.78.0/std/primitive.u32.html\">u32</a>,\n    max_index: <a class=\"primitive\" href=\"https://doc.rust-lang.org/1.78.0/std/primitive.u32.html\">u32</a>\n) -&gt; <a class=\"struct\" href=\"hypertree/red_black_tree/struct.RedBlackTreeReadOnly.html\" title=\"struct hypertree::red_black_tree::RedBlackTreeReadOnly\">RedBlackTreeReadOnly</a>&lt;'a, V&gt;</h4></section></summary><div class=\"docblock\"><p>Creates a new RedBlackTree. Does not mutate data yet. Assumes the actual\ndata in data is already well formed as a red black tree.</p>\n</div></details><details class=\"toggle method-toggle\" open><summary><section id=\"method.iter\" class=\"method\"><a class=\"src rightside\" href=\"src/hypertree/red_black_tree.rs.html#58\">source</a><h4 class=\"code-header\">pub fn <a href=\"hypertree/red_black_tree/struct.RedBlackTreeReadOnly.html#tymethod.iter\" class=\"fn\">iter</a>(&amp;self) -&gt; <a class=\"struct\" href=\"hypertree/red_black_tree/struct.RedBlackTreeReadOnlyIterator.html\" title=\"struct hypertree::red_black_tree::RedBlackTreeReadOnlyIterator\">RedBlackTreeReadOnlyIterator</a>&lt;'_, V&gt;</h4></section></summary><div class=\"docblock\"><p>Sorted iterator starting from the min.</p>\n</div></details></div></details>",0,"manifest::state::global::GlobalTraderTreeReadOnly","manifest::state::market::ClaimedSeatTreeReadOnly","manifest::state::market::BooksideReadOnly"]]
};if (window.register_type_impls) {window.register_type_impls(type_impls);} else {window.pending_type_impls = type_impls;}})()