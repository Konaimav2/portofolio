"""
inject_dynamic.py — LEGACY / DEPRECATED

This script was used to wire static HTML files to the Express backend during
early development. The HTML files have since been updated manually and already
contain the correct production API base URL (https://api.arraffi.my.id).

DO NOT RUN this script — it will overwrite the correct production URLs with
stale localhost:3000 references.

Kept for historical reference only.
"""
import sys
print("ERROR: This script is deprecated and must not be run.")
print("The frontend HTML files already point to the correct production API.")
sys.exit(1)
