"""Short follow-up the person can copy. Nothing is sent."""


def draft_follow_up(title: str, company: str, overlaps: list[str]) -> str:
    target = title or "the role"
    if company:
        target = f"{target} at {company}"
    skills = [item for item in overlaps if item][:2]
    skill_sentence = ""
    if skills:
        skill_sentence = " The overlap I can point to is " + " and ".join(skills) + "."
    text = (
        f"Hello, I recently applied for {target}.{skill_sentence} "
        "Happy to share anything else that would be useful."
    )
    words = text.split()
    if len(words) > 120:
        text = " ".join(words[:120])
    return text
