"""Version-1, single-request framed stdio. No sockets, temp photos, or pickle."""
import json
import struct

HEADER_LIMIT = 65536
PAYLOAD_LIMIT = 536870912


class ProtocolError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def require(condition, code, message):
    if not condition:
        raise ProtocolError(code, message)


def integer(value, minimum, maximum, label):
    require(type(value) is int and minimum <= value <= maximum, "INVALID_INPUT", f"Invalid {label}.")
    return value


def read_exact(stream, count):
    parts = []
    remaining = count
    while remaining:
        part = stream.read(min(remaining, 1024 * 1024))
        require(bool(part), "PROTOCOL_ERROR", "Truncated input frame.")
        parts.append(part)
        remaining -= len(part)
    return b"".join(parts)


def read_frame(stream):
    length = struct.unpack(">I", read_exact(stream, 4))[0]
    require(0 < length <= HEADER_LIMIT, "PROTOCOL_ERROR", "Header exceeds protocol limit.")
    try:
        def invalid_constant(value):
            raise ValueError("Non-finite JSON number")
        header = json.loads(read_exact(stream, length).decode("utf-8"), parse_constant=invalid_constant)
    except (ValueError, UnicodeError) as exc:
        raise ProtocolError("PROTOCOL_ERROR", "Invalid UTF-8 JSON header.") from exc
    require(type(header) is dict and header.get("protocol") == 1, "PROTOCOL_ERROR", "Unsupported protocol version.")
    count = integer(header.get("payloadBytes"), 0, PAYLOAD_LIMIT, "payload length")
    payload = read_exact(stream, count)
    require(stream.read(1) == b"", "PROTOCOL_ERROR", "Exactly one frame is permitted per process.")
    return header, payload


def write_frame(stream, header, payload=b""):
    require(type(payload) is bytes and len(payload) <= PAYLOAD_LIMIT, "INVALID_OUTPUT", "Output must be bounded bytes.")
    encoded = json.dumps({**header, "payloadBytes": len(payload)}, separators=(",", ":"), allow_nan=False).encode("utf-8")
    require(len(encoded) <= HEADER_LIMIT, "INVALID_OUTPUT", "Output header exceeds protocol limit.")
    stream.write(struct.pack(">I", len(encoded)))
    stream.write(encoded)
    stream.write(payload)
    stream.flush()
