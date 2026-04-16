

#include "pin.H"

#include <iostream>
#include <fstream>

using std::endl;
using std::ofstream;

ofstream TraceFile;

// Limit number of instructions to avoid huge files
UINT64 ins_count = 0;
const UINT64 MAX_INS = 100000;

// ============================================
// Analysis Routine (called at runtime)
// ============================================

VOID RecordMemRead(VOID *ip, VOID *addr)
{
    if (ins_count++ > MAX_INS)
    {
        TraceFile.close();
        exit(0);
    }

    TraceFile << " R " << addr << '\n';
}

VOID RecordMemWrite(VOID *ip, VOID *addr)
{
    if (ins_count++ > MAX_INS)
    {
        TraceFile.close();
        exit(0);
    }

    TraceFile << " W " << addr << '\n';
}

// ============================================
// Instrumentation Routine (called at compile time)
// ============================================

VOID Instruction(INS ins, VOID *v)
{
    // Check for memory READ
    if (INS_IsMemoryRead(ins))
    {
        INS_InsertPredicatedCall(
            ins,
            IPOINT_BEFORE,
            (AFUNPTR)RecordMemRead,
            IARG_INST_PTR,      // PC
            IARG_MEMORYREAD_EA, // Memory address
            IARG_END);
    }

    // Some instructions have 2 memory reads
    if (INS_HasMemoryRead2(ins))
    {
        INS_InsertPredicatedCall(
            ins,
            IPOINT_BEFORE,
            (AFUNPTR)RecordMemRead,
            IARG_INST_PTR,
            IARG_MEMORYREAD2_EA,
            IARG_END);
    }

    // Check for memory WRITE
    if (INS_IsMemoryWrite(ins))
    {
        INS_InsertPredicatedCall(
            ins,
            IPOINT_BEFORE,
            (AFUNPTR)RecordMemWrite,
            IARG_INST_PTR,
            IARG_MEMORYWRITE_EA,
            IARG_END);
    }
}

// ============================================
// Finalization
// ============================================

VOID Fini(INT32 code, VOID *v)
{
    TraceFile.close();
}

// ============================================
// Main
// ============================================

int main(int argc, char *argv[])
{
    if (PIN_Init(argc, argv))
    {
        std::cerr << "PIN Init Failed" << '\n';
        return 1;
    }

    TraceFile.open("memtrace.out");

    INS_AddInstrumentFunction(Instruction, 0);
    PIN_AddFiniFunction(Fini, 0);

    PIN_StartProgram(); // Never returns

    return 0;
}