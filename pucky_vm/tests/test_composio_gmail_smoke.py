from tools.smoke_pucky_composio_gmail import _first_message_id


def test_first_message_id_accepts_message_id_variants() -> None:
    assert _first_message_id({"data": {"messages": [{"messageId": "msg-123"}]}}) == "msg-123"
    assert _first_message_id({"messages": [{"message_id": "msg-456"}]}) == "msg-456"
    assert _first_message_id({"messages": [{"id": "msg-789"}]}) == "msg-789"
