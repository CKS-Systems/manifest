#[derive(Clone, Copy, Ord, Eq, PartialEq, PartialOrd)]
enum CvtManifestOrder {
    None,
    CancelOrder,
    CancelOrderByIndex,
    PlaceOrder,
}

/// Keep track of which order was executed
static mut LAST_ORDER_EXECUTED: CvtManifestOrder = CvtManifestOrder::None;

// Initialization

pub fn initialize_hooks() {
    unsafe {
        LAST_ORDER_EXECUTED = CvtManifestOrder::None;
    }
}

// Setters

pub fn cancel_order_was_called()  {
    unsafe {
        LAST_ORDER_EXECUTED = CvtManifestOrder::CancelOrder;
    }
}

pub fn cancel_order_by_index_was_called()  {
    unsafe {
        LAST_ORDER_EXECUTED = CvtManifestOrder::CancelOrderByIndex;
    }
}

pub fn place_order_was_called()  {
    unsafe {
        LAST_ORDER_EXECUTED = CvtManifestOrder::PlaceOrder;
    }
}

// Getters

pub fn last_called_cancel_order() -> bool {
    unsafe { LAST_ORDER_EXECUTED == CvtManifestOrder::CancelOrder }
}

pub fn last_called_cancel_order_by_index() -> bool {
    unsafe { LAST_ORDER_EXECUTED == CvtManifestOrder::CancelOrderByIndex }
}

pub fn last_called_place_order() -> bool {
    unsafe { LAST_ORDER_EXECUTED == CvtManifestOrder::PlaceOrder }
}