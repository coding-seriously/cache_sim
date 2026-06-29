#ifndef POLICIES_H
#define POLICIES_H

#include "cache.h"
using namespace std;

int choose_line(Cache &cache, CacheSet &set);
void touch_line(Cache &cache, CacheLine &line);
void load_line(Cache &cache, CacheLine &line);

#endif