"""Start the installed Hermes with file and vision tools (no shell/browser)."""
import sys
from hermes_cli.main import main

if len(sys.argv) == 1:
    sys.argv.extend(["chat", "--cli"])
if sys.argv[1] == "chat":
    sys.argv.extend(["-t", "file,vision"])
main()
