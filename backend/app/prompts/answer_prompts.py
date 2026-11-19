"""Answer prompts stay unused by the rules engine.

Open questions are left blank for the person. This file records that policy
so a later model call cannot be wired in without an evidence check.
"""

ANSWER_SYSTEM_PROMPT = """Draft answers only from the candidate profile.
If a fact is missing, return an empty value.
Never invent years, employers, or authorization.
"""
