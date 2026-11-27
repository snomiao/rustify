#!/usr/bin/env python3
"""The terminal of the rustify parity runner. parity.mjs starts it for a case
that says "tty"; the cases-file reference is in parity.mjs.

Runs one command with a pseudo-terminal as its standard input, output and
error, or as only some of them, and writes down what that terminal was sent.

    python3 -I terminal.py <request.json> <command> [args...]
    python3 -I terminal.py --check       can a terminal be had here?

The request is a file with a JSON object:

    terminals   which of "stdin", "stdout" and "stderr" are the terminal. The
                others are passed on as this process has them, so a pipe or a
                file given to this process reaches the command untouched.
    type        [[wait, text], ...]: each text is typed into the terminal once
                the terminal has been sent `wait`, looked for after the place
                the wait before it was found. An empty `wait` is no wait; the
                texts that lead the list with one are typed before the command
                starts, so their echo always comes first.
    transcript  the file that receives every byte the terminal was sent, the
                echo of what was typed included.
    columns, rows   the size of the window.

The command becomes the leader of a session of its own with this terminal as
its controlling terminal, as under a terminal emulator: /dev/tty is this
terminal, and a typed Ctrl-C reaches the command as a signal. The terminal's
settings are the system's defaults (lines are read whole, typing is echoed, a
line feed is sent on as CR LF).

This process ends the way the command did: with its exit code, or by the
signal that ended it. When it is told to stop (the runner's timeout) it ends
the command and everything else in that session, and still writes the
transcript.

Linux and macOS; standard library only; Python 3.6 or later.
"""

import errno
import fcntl
import json
import os
import select
import signal
import struct
import subprocess
import sys
import termios
import time

STREAMS = ("stdin", "stdout", "stderr")
# The signals that ask this process to end.
STOPPING = (signal.SIGTERM, signal.SIGINT, signal.SIGHUP)

# A person answers a moment after the question appears. A program that prints
# its question and only then changes how the terminal treats typing (no echo
# for a password, single keys) is given that moment as well.
PAUSE_BEFORE_TYPING = 0.05

# The exit code when the command could not be started. No transcript is
# written then, which is how the runner tells it from a command's own code.
COULD_NOT_START = 127


class Stopped(Exception):
    """This process was sent a signal that asks it to end."""

    def __init__(self, number):
        super().__init__(number)
        self.number = number


def check():
    master, slave = os.openpty()
    os.close(master)
    os.close(slave)
    # The runner starts this interpreter by its full path from now on: a case
    # may run with a PATH that does not have it.
    print(sys.executable or "python3")
    return 0


def end_by(number):
    """Ends this process by the signal that ended the command."""
    try:
        import resource

        # Without a core file of this interpreter where the command left one.
        resource.setrlimit(resource.RLIMIT_CORE, (0, resource.getrlimit(resource.RLIMIT_CORE)[1]))
    except (ImportError, ValueError, OSError):
        pass
    try:
        signal.signal(number, signal.SIG_DFL)
    except (OSError, ValueError, RuntimeError):
        pass
    os.kill(os.getpid(), number)
    time.sleep(1)
    return 128 + number


def run(request, command):
    terminals = [name for name in STREAMS if name in request.get("terminals", [])]
    steps = [(wait.encode("utf-8", "replace"), text.encode("utf-8", "replace")) for wait, text in request.get("type", [])]
    transcript = bytearray()
    state = {"searched": 0, "queue": b"", "type_at": 0.0, "open": True}

    master, slave = os.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", int(request.get("rows", 24)), int(request.get("columns", 80)), 0, 0))
    os.set_blocking(master, False)

    def due():
        """Moves the text of every step whose wait is over to what is typed next."""
        while steps:
            wait, text = steps[0]
            if wait:
                at = transcript.find(wait, state["searched"])
                if at < 0:
                    return
                state["searched"] = at + len(wait)
                state["type_at"] = time.monotonic() + PAUSE_BEFORE_TYPING
            steps.pop(0)
            state["queue"] += text

    def read_terminal():
        try:
            data = os.read(master, 65536)
        except BlockingIOError:
            return False
        except OSError as error:
            # Linux reports a terminal that nothing holds open any more this way.
            if error.errno != errno.EIO:
                raise
            data = b""
        if not data:
            state["open"] = False
            return False
        transcript.extend(data)
        due()
        return True

    def type_some():
        try:
            written = os.write(master, state["queue"])
        except BlockingIOError:
            return
        state["queue"] = state["queue"][written:]
        # Linux takes in typed bytes, and echoes them, a moment later, from a
        # kernel thread. Asking whether the other end has input waits for
        # that, so the echo is queued ahead of anything the command writes
        # from here on. (Linux 5.15, typed text and then output written at
        # once: the echo came first in 358 of 3000 tries without this, in all
        # 3000 with it.)
        try:
            select.select([slave], [], [], 0)
        except OSError:
            pass

    def read_the_rest():
        while state["open"] and select.select([master], [], [], 0)[0] and read_terminal():
            pass

    def write_transcript():
        with open(request["transcript"], "wb") as file:
            file.write(transcript)

    # A signal handler that does nothing, and a pipe that gets a byte for
    # every signal: the wait below wakes up when the command has ended.
    wake_read, wake_write = os.pipe()
    os.set_blocking(wake_read, False)
    os.set_blocking(wake_write, False)
    signal.signal(signal.SIGCHLD, lambda number, frame: None)
    signal.set_wakeup_fd(wake_write)

    def stop(number, frame):
        raise Stopped(number)

    for number in STOPPING:
        signal.signal(number, stop)

    child = None
    try:
        due()
        if state["queue"]:
            type_some()

        def take_the_terminal():
            # Runs in the child, which is a session leader by now.
            if hasattr(termios, "TIOCSCTTY"):
                fcntl.ioctl(slave, termios.TIOCSCTTY, 0)
            else:
                # Where the constant is not known, opening the terminal does it
                # (System V's way, which Linux follows too).
                os.close(os.open(os.ttyname(slave), os.O_RDWR))

        stdio = [slave if name in terminals else None for name in STREAMS]
        try:
            child = subprocess.Popen(command, stdin=stdio[0], stdout=stdio[1], stderr=stdio[2], start_new_session=True, preexec_fn=take_the_terminal)
        except OSError as error:
            sys.stderr.write("could not run %s: %s\n" % (command[0], error.strerror or error))
            return COULD_NOT_START
        except subprocess.SubprocessError as error:
            # take_the_terminal failed in the child, before the command started.
            sys.stderr.write("could not give %s the terminal: %s\n" % (command[0], error))
            return COULD_NOT_START

        # This process keeps its own handle on the terminal until the end. The
        # terminal then outlives the command, and what the command wrote last
        # is still there to be read.
        while child.poll() is None:
            now = time.monotonic()
            typing = bool(state["queue"]) and now >= state["type_at"]
            # One second at most: the wake-up above is the rule, this is for a signal that got lost.
            timeout = 1.0 if typing or not state["queue"] else min(1.0, state["type_at"] - now)
            readable, writable, _ = select.select([wake_read] + ([master] if state["open"] else []), [master] if typing and state["open"] else [], [], timeout)
            if master in readable:
                read_terminal()
            if master in writable:
                type_some()
            if wake_read in readable:
                try:
                    os.read(wake_read, 4096)
                except BlockingIOError:
                    pass
        # The command has ended, so nothing more is coming from it: read what
        # the terminal still holds. (What a process it left behind writes
        # later is not waited for.)
        read_the_rest()
        write_transcript()
    except Stopped as stopped:
        for number in STOPPING:
            signal.signal(number, signal.SIG_IGN)
        if child is not None:
            try:
                os.killpg(child.pid, signal.SIGKILL)
            except OSError:
                pass
            child.wait()
        read_the_rest()
        write_transcript()
        return end_by(stopped.number)
    if child.returncode < 0:
        return end_by(-child.returncode)
    return child.returncode


def main(argv):
    if argv[1:] == ["--check"]:
        try:
            return check()
        except OSError as error:
            sys.stderr.write("%s\n" % (error.strerror or error))
            return 1
    if len(argv) < 3:
        sys.stderr.write(__doc__)
        return 2
    with open(argv[1], encoding="utf-8") as file:
        request = json.load(file)
    return run(request, argv[2:])


if __name__ == "__main__":
    sys.exit(main(sys.argv))
