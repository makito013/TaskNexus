"""Test environment shared by the whole suite.

`TestClient` sends `Host: testserver`. The origin guard (`app.request_guard`) accepts no dotless name
besides `localhost` and the machine name, so the suite lists it through the production setting
`CHAT_ALLOWED_HOSTS`, set before any `app` module is imported (child processes inherit it). Nothing else
is touched; a test that needs another value patches the environment itself.
"""
import os

os.environ["CHAT_ALLOWED_HOSTS"] = "testserver"
