#!/usr/bin/env python3
"""Render only the fixed, nonsecret fixture SQL for an Owner SQL-editor request.

No connection, token, credential, arbitrary SQL or input filename is accepted.
Output is intentionally nonsecret SQL, not a way to deliver a credential.
"""
import argparse
from pathlib import Path
import re

SOURCE = Path(__file__).resolve().parent


def decimal(value):
    if not re.fullmatch(r'[0-9]{1,20}', str(value), flags=re.ASCII):
        raise ValueError('nonsecret_decimal_pin_required')
    return str(value)


def render(operation, system_id, database_oid, role_oid='0'):
    pins = {
        'expected_system_id': decimal(system_id),
        'expected_database_oid': decimal(database_oid),
        'expected_role_oid': decimal(role_oid),
    }
    if operation not in ('setup', 'activate', 'fence-commit', 'drain'):
        raise ValueError('fixed_operation_required')
    name = 'fence' if operation in ('fence-commit', 'drain') else operation
    source = (SOURCE / f'{name}.sql').read_text()
    gate = (SOURCE / 'target-gate.sql').read_text()
    source = source.replace('\\set ON_ERROR_STOP on\n', '')
    source = source.replace('\\ir target-gate.sql\n', gate + '\n')
    if operation == 'fence-commit':
        source = source.split('DO $drain$\n', 1)[0]
    elif operation == 'drain':
        drain = 'DO $drain$\n' + source.split('DO $drain$\n', 1)[1]
        # A new request/session must independently establish every pin. Never
        # assume SQL-editor session affinity or a previous SET survives.
        source = ('BEGIN;\n' + gate + '\n'
                  "SELECT pg_catalog.set_config('vaeroex_jit.expected_role_oid', "
                  ":'expected_role_oid', true);\n" + drain + '\nCOMMIT;\n')
    for key, value in pins.items():
        source = source.replace(":'" + key + "'", "'" + value + "'")
    if '\\' in source or ":'expected_" in source:
        raise ValueError('unexpected_template_syntax')
    return source


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=('setup', 'activate', 'fence-commit', 'drain'))
    parser.add_argument('system_id')
    parser.add_argument('database_oid')
    parser.add_argument('role_oid', nargs='?', default='0')
    args = parser.parse_args()
    try:
        print(render(args.operation, args.system_id, args.database_oid, args.role_oid))
    except ValueError:
        parser.exit(64, 'fixed_nonsecret_input_rejected\n')
