"""
app/core/plugin_interface.py
────────────────────────────
Common Interface Contract for all tallying plugins.

Every plugin MUST implement these four methods:
  1. define_ballot_structure()  → describes how a ballot looks
  2. validate_ballot(ballot)    → returns (valid: bool, errors: list)
  3. count_votes(ballots)       → returns the tally result dict
  4. describe_results(result)   → returns human-readable plain text

This is the Strategy Pattern (Gamma et al. 1994) applied to electoral methods.
Swapping ACTIVE_METHOD in config is the only change needed to switch algorithms.
"""

from abc import ABC, abstractmethod
from typing import Any


class TallyingPlugin(ABC):
    """Base interface contract. All plugins inherit from this class."""

    @abstractmethod
    def define_ballot_structure(self) -> dict:
        """
        Returns a JSON-schema-like dict describing valid ballot format.
        Used by the frontend to dynamically render the correct ballot UI.
        """

    @abstractmethod
    def validate_ballot(self, ballot: dict) -> tuple[bool, list[str]]:
        """
        Validates a single ballot against the method's rules.
        Returns (is_valid, list_of_error_messages).
        Invalid ballots are logged and excluded before tallying.
        """

    @abstractmethod
    def count_votes(self, ballots: list[dict]) -> dict[str, Any]:
        """
        Counts all validated ballots and returns the full tally result.
        Result dict MUST contain at least: {'winner': ..., 'tally': ..., 'rounds': ...}
        """

    @abstractmethod
    def describe_results(self, result: dict[str, Any]) -> str:
        """
        Converts the tally result dict into plain-language text that
        non-technical electoral observers can verify without cryptographic knowledge.
        """

    @property
    @abstractmethod
    def method_name(self) -> str:
        """Short identifier, e.g. 'plurality', 'borda', 'stv', 'liquid'."""
